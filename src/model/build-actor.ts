import {
  Bone, Box3, BoxGeometry, BufferAttribute, CapsuleGeometry, Color, ConeGeometry,
  CylinderGeometry, Euler, LatheGeometry, MathUtils, MeshStandardMaterial, Quaternion, Scene, Skeleton,
  SkinnedMesh, SphereGeometry, TorusGeometry, Vector2, Vector3, type BufferGeometry,
} from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { actorPlanSchema, type ActorPlan } from './actor-plan';

type Part = ActorPlan['parts'][number];
type Finish = NonNullable<Part['finish']>;
const surfaces = {
  matte: { roughness: 0.8 },
  gloss: { roughness: 0.3 },
  metal: { roughness: 0.3, metalness: 0.75 },
} satisfies Record<Finish, { roughness: number; metalness?: number }>;
const mirroredJoints: Partial<Record<Part['joint'], Part['joint']>> = {
  leftArm: 'rightArm', rightArm: 'leftArm', leftLeg: 'rightLeg', rightLeg: 'leftLeg',
};

function lathe(profile: [radius: number, height: number][], segments: number) {
  return new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), segments);
}

function hairLock(segments: number) {
  const geometry = lathe([[0, -1], [0.16, -0.88], [0.29, -0.68], [0.43, -0.36], [0.53, 0.04], [0.54, 0.4], [0.42, 0.76], [0.22, 0.96], [0, 1]], segments);
  const { position, normal } = geometry.attributes;
  const n = new Vector3();
  for (let i = 0; i < position.count; i++) {
    const t = (1 - position.getY(i)) / 2;
    const bend = 0.95 * t * t * t;
    position.setX(i, position.getX(i) + bend);
    // Transform normals with the inverse transpose of the bend's local Jacobian.
    n.fromBufferAttribute(normal, i);
    n.y += 1.425 * t * t * n.x;
    n.normalize();
    normal.setXYZ(i, n.x, n.y, n.z);
  }
  return geometry;
}

function primitive(part: Part, actorScale: number): BufferGeometry {
  const relativeSize = Math.max(...part.size) / actorScale;
  const [radial, vertical] = relativeSize < 0.08 ? [8, 6] : relativeSize < 0.24 ? [16, 10] : [24, 16];
  switch (part.shape) {
    case 'sphere': return new SphereGeometry(1, radial, vertical);
    case 'box': return new BoxGeometry();
    case 'capsule': return new CapsuleGeometry(0.5, 1, Math.min(5, vertical / 2), radial);
    case 'cylinder': return new CylinderGeometry(1, 1, 1, radial);
    case 'cone': return new ConeGeometry(1, 1, radial);
    case 'torus': return new TorusGeometry(1, 0.3, Math.min(12, vertical), radial).rotateX(-Math.PI / 2);
    case 'dome': return lathe([[0, 0], [0.94, 0], [1, 0.06], [0.96, 0.30], [0.87, 0.65], [0.74, 0.9], [0.62, 0.98], [0.55, 1], [0, 1]], radial);
    case 'flare': return lathe([[0, 0], [0.93, 0], [1, 0.08], [0.92, 0.26], [0.58, 0.81], [0.41, 1], [0, 1]], radial);
    case 'lock': return hairLock(radial);
  }
}

function reflect(geometry: BufferGeometry) {
  const reflected = geometry.clone().scale(-1, 1, 1);
  // A reflection reverses winding; keep the visible surface and its transformed normals aligned.
  const indices = reflected.index!.array;
  for (let i = 0; i < indices.length; i += 3) {
    const b = indices[i + 1];
    indices[i + 1] = indices[i + 2];
    indices[i + 2] = b;
  }
  return reflected;
}

/** Builds a texture-free GLB in the browser without a renderer or executable plan input. */
export async function buildActorGlb(plan: ActorPlan, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  const { name, parts } = actorPlanSchema.parse(plan);
  const actorScale = Math.max(...parts.flatMap(part => part.size));
  const scene = new Scene();
  scene.name = name;
  const root = new Bone();
  root.name = 'root';
  const body = new Bone();
  body.name = 'body';
  root.add(body);
  scene.add(root);

  const bones = [root, body];
  const indices = new Map<Part['joint'], number>([['body', 1]]);
  const bounds = new Map<Part['joint'], Box3>();
  const actorBounds = new Box3();
  const geometries: BufferGeometry[] = [];
  const byFinish = new Map<Finish, BufferGeometry[]>();
  const materials: MeshStandardMaterial[] = [];
  let merged: BufferGeometry | undefined;
  let skeleton: Skeleton | undefined;

  function attach(geometry: BufferGeometry, joint: Part['joint'], color: Color, finish: Finish) {
    let jointIndex = indices.get(joint);
    if (jointIndex === undefined) {
      jointIndex = bones.length;
      indices.set(joint, jointIndex);
      const bone = new Bone();
      bone.name = joint;
      body.add(bone);
      bones.push(bone);
    }
    const partBounds = geometry.boundingBox!;
    actorBounds.union(partBounds);
    if (!bounds.has(joint)) bounds.set(joint, new Box3());
    bounds.get(joint)!.union(partBounds);

    // Rigid primitive skinning: every vertex follows its assigned semantic joint.
    const count = geometry.getAttribute('position').count;
    const skinIndices = new Uint16Array(count * 4);
    const skinWeights = new Float32Array(count * 4);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      skinIndices[i * 4] = jointIndex;
      skinWeights[i * 4] = 1;
      color.toArray(colors, i * 3);
    }
    geometry.setAttribute('skinIndex', new BufferAttribute(skinIndices, 4));
    geometry.setAttribute('skinWeight', new BufferAttribute(skinWeights, 4));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    if (!byFinish.has(finish)) byFinish.set(finish, []);
    byFinish.get(finish)!.push(geometry);
  }

  try {
    for (const part of parts) {
      signal.throwIfAborted();
      const geometry = primitive(part, actorScale);
      geometries.push(geometry);
      geometry.deleteAttribute('uv');
      geometry.center();
      const extents = geometry.boundingBox!.getSize(new Vector3());
      geometry.scale(part.size[0] / extents.x, part.size[1] / extents.y, part.size[2] / extents.z);
      if (part.rotation) {
        const [x, y, z] = part.rotation.map(MathUtils.degToRad);
        geometry.applyQuaternion(new Quaternion().setFromEuler(new Euler(x, y, z, 'XYZ')));
      }
      geometry.translate(...part.position);
      const color = new Color(part.color);
      const finish = part.finish ?? 'matte';
      // Clone before attaching attributes; the reflection may target a different bone.
      const opposite = part.mirror && Math.abs(part.position[0]) >= 0.01 ? reflect(geometry) : undefined;
      if (opposite) geometries.push(opposite);
      attach(geometry, part.joint, color, finish);
      if (opposite) attach(opposite, mirroredJoints[part.joint] ?? part.joint, color, finish);
    }

    const torso = bounds.get('body');
    (torso ?? actorBounds).getCenter(body.position);
    for (const [joint, index] of indices) {
      if (joint === 'body') continue;
      const box = bounds.get(joint)!;
      const pivot = box.getCenter(bones[index].position);
      if (joint === 'head') {
        // Use the torso's neckline; long hair shares the head bone but is not its anchor.
        if (torso) pivot.set(
          MathUtils.clamp(body.position.x, box.min.x, box.max.x),
          Math.min(torso.max.y, box.max.y),
          MathUtils.clamp(body.position.z, box.min.z, box.max.z),
        );
      } else if (joint === 'leftArm' || joint === 'rightArm') {
        pivot.y = MathUtils.lerp(box.max.y, box.min.y, 0.12);
      } else if (joint === 'leftLeg' || joint === 'rightLeg') {
        pivot.y = box.max.y;
      } else {
        box.clampPoint(body.position, pivot);
      }
      pivot.sub(body.position);
    }

    const geometry = mergeGeometries([...byFinish.values()].flat());
    if (!geometry) throw new Error('Actor geometry could not be merged');
    merged = geometry;
    let start = 0;
    for (const [finish, parts] of byFinish) {
      const count = parts.reduce((sum, part) => sum + part.index!.count, 0);
      merged.addGroup(start, count, materials.length);
      materials.push(new MeshStandardMaterial({ vertexColors: true, ...surfaces[finish] }));
      start += count;
    }
    const mesh = new SkinnedMesh(merged, materials.length === 1 ? materials[0] : materials);
    mesh.name = 'actorMesh';
    scene.add(mesh);
    scene.updateMatrixWorld(true);
    skeleton = new Skeleton(bones);
    mesh.bind(skeleton);

    signal.throwIfAborted();
    const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
    signal.throwIfAborted();
    if (!(glb instanceof ArrayBuffer)) throw new Error('Expected binary glTF from actor exporter');
    return new Blob([glb], { type: 'model/gltf-binary' });
  } finally {
    skeleton?.dispose();
    for (const material of materials) material.dispose();
    merged?.dispose();
    for (const geometry of geometries) geometry.dispose();
  }
}
