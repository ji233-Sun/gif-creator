import { expect, it } from 'vitest';
import { Bone, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

it('loads an embedded rigged GLB with usable skin weights and bones', async () => {
  const binary = new Uint8Array(96);
  binary.set(new Uint8Array(new Float32Array([-.5, 0, 0, .5, 0, 0, 0, 1, 0]).buffer));
  binary.set(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]), 36);
  binary.set(new Uint8Array(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]).buffer), 48);
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [{ mesh: 0, skin: 0 }, { name: 'hips', children: [2] }, { name: 'head', translation: [0, 1, 0] }],
    skins: [{ joints: [1, 2], skeleton: 1 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } }] }],
    buffers: [{ byteLength: 96 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 12 }, { buffer: 0, byteOffset: 48, byteLength: 48 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-.5, 0, 0], max: [.5, 1, 0] },
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
  const mesh = scene.children.find(node => node instanceof SkinnedMesh) as SkinnedMesh;
  expect(mesh).toBeInstanceOf(SkinnedMesh);
  expect(mesh.skeleton.bones).toHaveLength(2);
  expect(mesh.skeleton.bones.every(bone => bone instanceof Bone)).toBe(true);
  scene.updateMatrixWorld(true);
  const before = mesh.applyBoneTransform(2, new Vector3(0, 1, 0));
  mesh.skeleton.bones[1].position.x += 0.5;
  scene.updateMatrixWorld(true);
  const position = mesh.applyBoneTransform(2, new Vector3(0, 1, 0));
  expect(position.x).toBeCloseTo(before.x + 0.5);
  expect(position.y).toBeCloseTo(before.y);
});
