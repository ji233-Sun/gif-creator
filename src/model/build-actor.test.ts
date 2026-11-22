// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Bone, Box3, Color, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { z } from 'zod';
import { hasRenderableTriangle } from '../stage/geometry';
import { actorPlanSchema, type ActorPlan } from './actor-plan';
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
  expect(actorPlanSchema.safeParse({ name: 'Max', parts: Array(24).fill(part) }).success).toBe(true);
  const json = z.toJSONSchema(actorPlanSchema, { io: 'input', target: 'draft-2020-12' });
  expect(json).toMatchObject({
    type: 'object', required: ['name', 'parts'], additionalProperties: false,
    properties: { parts: { minItems: 1, maxItems: 24, items: {
      additionalProperties: false,
      required: ['shape', 'color', 'position', 'size', 'joint'],
      properties: { size: { type: 'array', prefixItems: Array(3).fill({ type: 'number', minimum: 0.01, maximum: 10 }) } },
    } } },
  });
});

it('rejects extra executable fields, malformed parts, and out-of-budget values', () => {
  const part = plan.parts[0];
  const invalidParts = [
    { ...part, script: 'return mesh' }, { ...part, shape: 'custom' }, { ...part, joint: 'wing' },
    { ...part, color: '#fff' }, { ...part, color: '#12345g' }, { ...part, position: [0, 0] },
    { ...part, position: [0, 0, 0, 0] }, { ...part, position: [11, 0, 0] },
    { ...part, size: [0, 1, 1] }, { ...part, size: [1, 11, 1] }, { ...part, size: [1, Infinity, 1] },
    { ...part, rotation: [0, NaN, 0] }, { ...part, rotation: [0, 0, 361] },
  ];
  for (const invalid of invalidParts) expect(actorPlanSchema.safeParse({ ...plan, parts: [invalid] }).success).toBe(false);
  for (const invalid of [{ ...plan, code: 'build()' }, { ...plan, parts: [] }, { ...plan, parts: Array(25).fill(part) }]) {
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
    expect(position.count).toBeLessThan(1000);
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

it('rejects both a pre-aborted build and cancellation during export', async () => {
  const controller = new AbortController();
  const pending = buildActorGlb(plan, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await expect(buildActorGlb(plan, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
