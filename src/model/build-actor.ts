import {
  Bone, Box3, BoxGeometry, BufferAttribute, CapsuleGeometry, Color, ConeGeometry,
  CylinderGeometry, Euler, MathUtils, MeshStandardMaterial, Quaternion, Scene, Skeleton,
  SkinnedMesh, SphereGeometry, TorusGeometry, Vector3, type BufferGeometry,
} from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { actorPlanSchema, type ActorPlan } from './actor-plan';

type Part = ActorPlan['parts'][number];

function primitive(shape: Part['shape']): BufferGeometry {
  switch (shape) {
    case 'sphere': return new SphereGeometry(1, 12, 8);
    case 'box': return new BoxGeometry();
    case 'capsule': return new CapsuleGeometry(0.5, 1, 4, 12);
    case 'cylinder': return new CylinderGeometry(1, 1, 1, 12);
    case 'cone': return new ConeGeometry(1, 1, 12);
    case 'torus': return new TorusGeometry(1, 0.3, 8, 12).rotateX(-Math.PI / 2);
  }
}

/** Builds a texture-free GLB in the browser without a renderer or executable plan input. */
export async function buildActorGlb(plan: ActorPlan, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  const { name, parts } = actorPlanSchema.parse(plan);
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
  let merged: BufferGeometry | undefined;
  let material: MeshStandardMaterial | undefined;
  let skeleton: Skeleton | undefined;

  try {
    for (const part of parts) {
      signal.throwIfAborted();
      let jointIndex = indices.get(part.joint);
      if (jointIndex === undefined) {
        jointIndex = bones.length;
        indices.set(part.joint, jointIndex);
        const bone = new Bone();
        bone.name = part.joint;
        body.add(bone);
        bones.push(bone);
      }

      const geometry = primitive(part.shape);
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
      const partBounds = geometry.boundingBox!;
      actorBounds.union(partBounds);
      if (!bounds.has(part.joint)) bounds.set(part.joint, new Box3());
      bounds.get(part.joint)!.union(partBounds);

      // Rigid primitive skinning: every vertex follows its assigned semantic joint.
      const count = geometry.getAttribute('position').count;
      const skinIndices = new Uint16Array(count * 4);
      const skinWeights = new Float32Array(count * 4);
      const colors = new Float32Array(count * 3);
      const color = new Color(part.color);
      for (let i = 0; i < count; i++) {
        skinIndices[i * 4] = jointIndex;
        skinWeights[i * 4] = 1;
        color.toArray(colors, i * 3);
      }
      geometry.setAttribute('skinIndex', new BufferAttribute(skinIndices, 4));
      geometry.setAttribute('skinWeight', new BufferAttribute(skinWeights, 4));
      geometry.setAttribute('color', new BufferAttribute(colors, 3));
    }

    (bounds.get('body') ?? actorBounds).getCenter(body.position);
    for (const [joint, index] of indices) {
      if (joint === 'body') continue;
      // Put the pivot on the body-facing side of the parts assigned to this joint.
      bounds.get(joint)!.clampPoint(body.position, bones[index].position).sub(body.position);
    }

    const geometry = mergeGeometries(geometries);
    if (!geometry) throw new Error('Actor geometry could not be merged');
    merged = geometry;
    material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    const mesh = new SkinnedMesh(merged, material);
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
    material?.dispose();
    merged?.dispose();
    for (const geometry of geometries) geometry.dispose();
  }
}
