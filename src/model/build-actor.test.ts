// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Bone, Box3, Color, MeshStandardMaterial, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { z } from 'zod';
import { hasRenderableTriangle } from '../stage/geometry';
import { actorPlanSchema, actorPlanToolSchema, type ActorPlan } from './actor-plan';
import { buildActorGlb } from './build-actor';

const plan: ActorPlan = {
  name: 'Paji',
  parts: [
    { shape: 'box', color: '#ea94bb', position: [0, 2, 0], size: [2, 1, 1], rotation: [0, 0, 90], joint: 'body' },
    { shape: 'sphere', color: '#ffffff', position: [0, 3.5, 0], size: [1.5, 1, 0.8], joint: 'head' },
    { shape: 'capsule', color: '#bbbbff', position: [1.2, 2, 0], size: [0.5, 1.4, 0.6], joint: 'leftArm' },
    { shape: 'cylinder', color: '#ccbbff', position: [-1.2, 2, 0], size: [0.6, 1.4, 0.5], joint: 'rightArm' },
    { shape: 'cone', color: '#ffbbbb', position: [0.4, 0.5, 0], size: [0.5, 1, 0.6], joint: 'leftLeg' },
    { shape: 'cone', color: '#ffccbb', position: [-0.4, 0.5, 0], size: [0.6, 1, 0.5], joint: 'rightLeg' },
    { shape: 'torus', color: '#bbbbbb', position: [0, 2, -1], size: [0.5, 0.3, 1], joint: 'tail' },
  ],
};

beforeEach(() => {
  // Three r170's texture-free binary export only needs readAsArrayBuffer and onloadend.
  vi.stubGlobal('FileReader', class {
    result: ArrayBuffer | null = null;
    onloadend?: () => void;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then(result => {
        this.result = result;
        this.onloadend?.();
      });
    }
  });
});
afterEach(() => vi.unstubAllGlobals());

it('accepts exactly the bounded plan data and emits standard JSON Schema constraints', () => {
  expect(actorPlanSchema.parse(plan)).toEqual(plan);
  const part = plan.parts[0];
  expect(actorPlanSchema.safeParse({ name: 'Max', parts: Array(40).fill(part) }).success).toBe(true);
  const json = z.toJSONSchema(actorPlanSchema, { io: 'input', target: 'draft-2020-12' });
  expect(json).toMatchObject({
    type: 'object', required: ['name', 'parts'], additionalProperties: false,
    properties: { parts: { minItems: 1, maxItems: 40, items: {
      additionalProperties: false,
      required: ['shape', 'color', 'position', 'size', 'joint'],
      properties: { size: { type: 'array', prefixItems: Array(3).fill({ type: 'number', minimum: 0.01, maximum: 10 }) } },
    } } },
  });
  expect(actorPlanToolSchema.properties.parts).toMatchObject({ maxItems: 40, items: { properties: {
    size: { minItems: 3, maxItems: 3, items: { minimum: 0.01, maximum: 10 } },
    shape: { enum: expect.arrayContaining(['dome', 'flare', 'lock']) },
    mirror: { type: 'boolean' }, finish: { enum: ['matte', 'gloss', 'metal'] },
  } } });
});

it('rejects extra executable fields, malformed parts, and out-of-budget values', () => {
  const part = plan.parts[0];
  const invalidParts = [
    { ...part, script: 'return mesh' }, { ...part, shape: 'custom' }, { ...part, joint: 'wing' },
    { ...part, color: '#fff' }, { ...part, color: '#12345g' }, { ...part, position: [0, 0] },
    { ...part, position: [0, 0, 0, 0] }, { ...part, position: [11, 0, 0] },
    { ...part, size: [0, 1, 1] }, { ...part, size: [1, 11, 1] }, { ...part, size: [1, Infinity, 1] },
    { ...part, rotation: [0, NaN, 0] }, { ...part, rotation: [0, 0, 361] },
    { ...part, mirror: 'true' }, { ...part, finish: 'custom' },
  ];
  for (const invalid of invalidParts) expect(actorPlanSchema.safeParse({ ...plan, parts: [invalid] }).success).toBe(false);
  for (const invalid of [{ ...plan, code: 'build()' }, { ...plan, parts: [] }, { ...plan, parts: Array(41).fill(part) }]) {
    expect(actorPlanSchema.safeParse(invalid).success).toBe(false);
  }
});

it('exports a stage-renderable GLB with full extents, colors and working semantic skinning', async () => {
  const blob = await buildActorGlb(plan, new AbortController().signal);
  expect(blob.type).toBe('model/gltf-binary');
  const bytes = await blob.arrayBuffer();
  const header = new DataView(bytes);
  expect(header.getUint32(0, true)).toBe(0x46546c67);
  expect(header.getUint32(4, true)).toBe(2);
  expect(header.getUint32(8, true)).toBe(bytes.byteLength);
  const { scene } = await new GLTFLoader().parseAsync(bytes, '');
  const mesh = scene.getObjectByName('actorMesh');
  if (!(mesh instanceof SkinnedMesh)) throw new Error('Expected a skinned actor mesh');
  try {
    scene.updateMatrixWorld(true);
    expect(scene.name).toBe(plan.name);
    expect(hasRenderableTriangle(mesh)).toBe(true);
    expect(new Box3().setFromObject(scene).isEmpty()).toBe(false);
    const { bones } = mesh.skeleton;
    expect(bones.map(bone => bone.name)).toEqual(['root', ...plan.parts.map(part => part.joint)]);
    expect(bones.every(bone => bone instanceof Bone)).toBe(true);
    expect(bones[1].parent).toBe(bones[0]);
    for (const bone of bones.slice(2)) expect(bone.parent).toBe(bones[1]);

    const { position, skinIndex, skinWeight, color } = mesh.geometry.attributes;
    expect(position.count).toBeLessThan(2000);
    const point = new Vector3();
    const posed = new Vector3();
    for (const part of plan.parts) {
      const box = new Box3();
      const joint = bones.findIndex(bone => bone.name === part.joint);
      const expectedColor = new Color(part.color);
      for (let i = 0; i < position.count; i++) {
        if (skinIndex.getX(i) !== joint) continue;
        expect(Array.from(skinWeight.array.slice(i * 4, i * 4 + 4))).toEqual([1, 0, 0, 0]);
        expect(color.getX(i)).toBeCloseTo(expectedColor.r, 6);
        expect(color.getY(i)).toBeCloseTo(expectedColor.g, 6);
        expect(color.getZ(i)).toBeCloseTo(expectedColor.b, 6);
        point.fromBufferAttribute(position, i);
        expect(mesh.getVertexPosition(i, posed).distanceTo(point)).toBeLessThan(1e-6);
        box.expandByPoint(point);
      }
      expect(box.isEmpty()).toBe(false);
      const size = part.rotation ? [part.size[1], part.size[0], part.size[2]] : part.size;
      box.getSize(point).toArray().forEach((value, axis) => expect(value).toBeCloseTo(size[axis], 5));
      box.getCenter(point).toArray().forEach((value, axis) => expect(value).toBeCloseTo(part.position[axis], 5));
    }

    const head = bones[2];
    const pivot = head.getWorldPosition(new Vector3());
    expect(pivot.toArray()).toEqual([0, 3, 0]);
    const headVertex = Array.from({ length: position.count }, (_, i) => i).find(i => skinIndex.getX(i) === 2)!;
    const headBefore = mesh.getVertexPosition(headVertex, new Vector3());
    const bodyBefore = mesh.getVertexPosition(0, new Vector3());
    head.rotation.z = Math.PI / 2;
    scene.updateMatrixWorld(true);
    const expected = headBefore.clone().sub(pivot).applyAxisAngle(new Vector3(0, 0, 1), Math.PI / 2).add(pivot);
    expect(headBefore.distanceTo(expected)).toBeGreaterThan(0.1);
    expect(mesh.getVertexPosition(headVertex, posed).distanceTo(expected)).toBeLessThan(1e-6);
    expect(mesh.getVertexPosition(0, posed).distanceTo(bodyBefore)).toBeLessThan(1e-6);
  } finally {
    mesh.geometry.dispose();
    mesh.skeleton.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach(material => material.dispose());
  }
});

it('round-trips sculpted shapes and surface finishes, and reflects a rotated part with the correct joint and winding', async () => {
  const sculpted: ActorPlan = { name: 'Sculpted', parts: [
    { shape: 'flare', color: '#345678', position: [0, 1, 0], size: [1.1, 1.2, 0.8], joint: 'body' },
    { shape: 'dome', color: '#b8babd', position: [0, 2.5, 0], size: [1.6, 0.7, 1.5], joint: 'head', finish: 'metal' },
    { shape: 'lock', color: '#1039ab', position: [0.8, 1.4, 0.2], size: [0.4, 1.2, 0.3], rotation: [15, 25, 35], joint: 'leftArm', finish: 'gloss', mirror: true },
  ] };
  const glb = await buildActorGlb(sculpted, new AbortController().signal);
  const { scene } = await new GLTFLoader().parseAsync(await glb.arrayBuffer(), '');
  const meshes: SkinnedMesh[] = [];
  scene.traverse(node => { if (node instanceof SkinnedMesh) meshes.push(node); });
  try {
    expect(meshes).toHaveLength(3);
    expect(meshes.every(mesh => hasRenderableTriangle(mesh))).toBe(true);
    const materials = meshes.map(mesh => mesh.material as MeshStandardMaterial);
    expect(materials.map(({ roughness, metalness }) => [roughness, metalness])).toEqual([[0.8, 0], [0.3, 0.75], [0.3, 0]]);

    const hair = meshes[2];
    const { position, normal, skinIndex } = hair.geometry.attributes;
    const left = hair.skeleton.bones.findIndex(bone => bone.name === 'leftArm');
    const right = hair.skeleton.bones.findIndex(bone => bone.name === 'rightArm');
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    const used = Array.from(hair.geometry.index!.array);
    const leftIds = [...new Set(used.filter(i => skinIndex.getX(i) === left))].sort((a, b) => a - b);
    const rightIds = [...new Set(used.filter(i => skinIndex.getX(i) === right))].sort((a, b) => a - b);
    expect(leftIds.length).toBeGreaterThan(100);
    expect(rightIds).toHaveLength(leftIds.length);
    for (const [i, a] of leftIds.entries()) {
      const b = rightIds[i];
      for (const attr of [position, normal]) {
        expect(attr.getX(a)).toBeCloseTo(-attr.getX(b), 6);
        expect(attr.getY(a)).toBeCloseTo(attr.getY(b), 6);
        expect(attr.getZ(a)).toBeCloseTo(attr.getZ(b), 6);
      }
    }
    expect(used.length % 6).toBe(0);
    const offset = used.length / 2;
    const vertexOffset = rightIds[0] - leftIds[0];
    for (let i = 0; i < offset; i += 3) {
      expect(used.slice(i + offset, i + offset + 3)).toEqual([used[i], used[i + 2], used[i + 1]].map(index => index + vertexOffset));
    }
  } finally {
    meshes.forEach(mesh => {
      mesh.geometry.dispose();
      mesh.skeleton.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
    });
  }
});

it('keeps long hair from dragging the neck pivot down and puts the limbs at their upper attachment', async () => {
  const posedPlan: ActorPlan = { name: 'Long hair', parts: [
    { shape: 'box', color: '#222288', position: [0, 0.75, 0], size: [0.50, 0.5, 0.4], joint: 'body' },
    { shape: 'sphere', color: '#ddaa77', position: [0, 1.25, 0], size: [0.5, 0.5, 0.5], joint: 'head', mirror: true },
    { shape: 'lock', color: '#333388', position: [0.22, 0.9, 0], size: [0.3, 1.1, 0.3], joint: 'head', mirror: true },
    { shape: 'capsule', color: '#222266', position: [0.3, 0.75, 0], size: [0.13, 0.5, 0.1], joint: 'leftArm' },
    { shape: 'capsule', color: '#dddddd', position: [0.1, 0.27, 0], size: [0.13, 0.5, 0.1], joint: 'leftLeg' },
  ] };
  const signal = new AbortController().signal;
  const file = await buildActorGlb(posedPlan, signal);
  const withoutCenteredMirror = await buildActorGlb({ ...posedPlan, parts: posedPlan.parts.map((part, i) => i === 1 ? { ...part, mirror: false } : part) }, signal);
  expect(file.size).toBe(withoutCenteredMirror.size);
  const { scene } = await new GLTFLoader().parseAsync(await file.arrayBuffer(), '');
  const mesh = scene.getObjectByName('actorMesh') as SkinnedMesh;
  try {
    const world = (name: string) => mesh.skeleton.getBoneByName(name)!.getWorldPosition(new Vector3());
    expect(world('head').y).toBeCloseTo(1);
    expect(world('leftArm').y).toBeCloseTo(0.94);
    expect(world('leftLeg').y).toBeCloseTo(0.52);
    expect(world('leftLeg').x).toBeCloseTo(0.1);
  } finally {
    mesh.geometry.dispose();
    mesh.skeleton.dispose();
    (mesh.material as MeshStandardMaterial).dispose();
  }
});

it('does not spend full-size sphere tessellation on tiny highlights', async () => {
  const glb = await buildActorGlb({ name: 'LOD', parts: [
    { shape: 'sphere', color: '#123456', position: [0, 1, 0], size: [1, 1, 1], joint: 'body' },
    { shape: 'sphere', color: '#ffffff', position: [0, 1, 0.5], size: [0.03, 0.03, 0.025], joint: 'body' },
  ] }, new AbortController().signal);
  const { scene } = await new GLTFLoader().parseAsync(await glb.arrayBuffer(), '');
  const mesh = scene.getObjectByName('actorMesh') as SkinnedMesh;
  try {
    const color = mesh.geometry.attributes.color;
    const fullSize = Array.from({ length: color.count }, (_, i) => color.getX(i)).filter(x => x < 0.5).length;
    expect(fullSize).toBeGreaterThan(300);
    expect(color.count - fullSize).toBeLessThan(fullSize / 4);
  } finally {
    mesh.geometry.dispose();
    mesh.skeleton.dispose();
    (mesh.material as MeshStandardMaterial).dispose();
  }
});

it('rejects both a pre-aborted build and cancellation during export', async () => {
  const controller = new AbortController();
  const pending = buildActorGlb(plan, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await expect(buildActorGlb(plan, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
