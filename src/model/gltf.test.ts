import { expect, it } from 'vitest';
import { Bone, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { hasRenderableTriangle } from '../stage/geometry';

async function parseRig(height: number, parentScale?: number, parentTranslation?: [number, number, number]) {
  const binary = new Uint8Array(96);
  binary.set(new Uint8Array(new Float32Array([0, 0, 0, 2, 0, 0, 3, height, 0]).buffer));
  binary.set(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]), 36);
  binary.set(new Uint8Array(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]).buffer), 48);
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: parentScale === undefined ? [0, 1] : [3] }],
    nodes: [{ mesh: 0, skin: 0 }, { name: 'hips', children: [2] }, { name: 'head' }, ...(parentScale === undefined ? [] : [{
      children: [0, 1], rotation: [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)],
      translation: parentTranslation ?? [5 * parentScale, -3 * parentScale, 0], scale: [parentScale, parentScale, parentScale],
    }])],
    skins: [{ joints: [1, 2], skeleton: 1 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } }] }],
    buffers: [{ byteLength: 96 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 12 }, { buffer: 0, byteOffset: 48, byteLength: 48 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [3, height, 0] },
      { bufferView: 1, componentType: 5121, count: 3, type: 'VEC4' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' },
    ],
  };
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const glb = new Uint8Array(28 + jsonLength + binary.length);
  const header = new DataView(glb.buffer);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, glb.length, true);
  header.setUint32(12, jsonLength, true); header.setUint32(16, 0x4e4f534a, true);
  glb.fill(32, 20, 20 + jsonLength); glb.set(text, 20);
  header.setUint32(20 + jsonLength, binary.length, true); header.setUint32(24 + jsonLength, 0x004e4942, true);
  glb.set(binary, 28 + jsonLength);
  const { scene } = await new GLTFLoader().parseAsync(glb.buffer, '');
  const mesh = scene.getObjectByProperty('isSkinnedMesh', true);
  if (!(mesh instanceof SkinnedMesh)) throw new Error('fixture must include a skinned mesh');
  scene.updateMatrixWorld(true);
  return { scene, mesh };
}

it('loads an embedded rigged GLB with usable skin weights and bones', async () => {
  const { scene, mesh } = await parseRig(1);
  expect(hasRenderableTriangle(mesh)).toBe(true);
  expect(mesh.skeleton.bones).toHaveLength(2);
  expect(mesh.skeleton.bones.every(bone => bone instanceof Bone)).toBe(true);
  const before = mesh.applyBoneTransform(2, new Vector3(0, 1, 0));
  mesh.skeleton.bones[1].position.x += 0.5;
  scene.updateMatrixWorld(true);
  const position = mesh.applyBoneTransform(2, new Vector3(0, 1, 0));
  expect(position.x).toBeCloseTo(before.x + 0.5);
  expect(position.y).toBeCloseTo(before.y);
});

it('rejects a skinned GLB with only collinear vertices despite bones and nonzero extent', async () => {
  const { mesh } = await parseRig(0);
  expect(mesh.skeleton.bones).toHaveLength(2);
  expect(hasRenderableTriangle(mesh)).toBe(false);
});

it.each([1e-9, 1, 1e9])('distinguishes collinear and thin skinned triangles under a transformed parent (scale %s)', async scale => {
  const { mesh: collinear } = await parseRig(0, scale);
  const { mesh: thin } = await parseRig(1e-7, scale);
  expect(hasRenderableTriangle(collinear)).toBe(false);
  expect(hasRenderableTriangle(thin)).toBe(true);
});

it('does not let the skinning round trip create a face from authored collinear vertices', async () => {
  const { mesh: collinear } = await parseRig(0, 0.001, [8, 3, 0]);
  const { mesh: thin } = await parseRig(1e-7, 0.001, [8, 3, 0]);
  expect(hasRenderableTriangle(collinear)).toBe(false);
  expect(hasRenderableTriangle(thin)).toBe(true);
});

it('also rejects an authored face collapsed by the preview pose', async () => {
  const { mesh, scene } = await parseRig(1);
  mesh.skeleton.bones[1].position.y = -1;
  scene.updateMatrixWorld(true);
  expect(hasRenderableTriangle(mesh)).toBe(false);
});
