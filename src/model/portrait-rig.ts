import {
  AnimationClip, Bone, BufferAttribute, MathUtils, MeshBasicMaterial, PlaneGeometry,
  Quaternion, QuaternionKeyframeTrack, Scene, Skeleton, SkinnedMesh, Vector3,
  VectorKeyframeTrack, type Texture,
} from 'three';

export type PortraitLayout = { width: number; height: number; neckFromTop: number };
export type PortraitMotion = 'bounce' | 'nod' | 'wiggle';
const height = 2;
const duration = 2.4;
const up = new Vector3(0, 1, 0);
const depth = new Vector3(0, 0, 1);

/** Experimental front-facing rig; `texture` is a cropped, masked original image owned by the caller. */
export function createPortraitRig(texture: Texture, layout: PortraitLayout, motion: PortraitMotion = 'bounce') {
  const { width, height: pixels, neckFromTop } = layout;
  const aspect = width / pixels;
  if (![width, pixels, neckFromTop].every(Number.isFinite) || width <= 0 || pixels <= 0 || aspect < 0.1 || aspect > 5 || neckFromTop <= 0.2 || neckFromTop >= 0.8) {
    throw new Error('Invalid portrait layout');
  }
  const neckY = height * (1 - neckFromTop);
  const scene = new Scene();
  scene.name = 'PortraitActor';
  const root = new Bone(); root.name = 'portraitRoot';
  const body = new Bone(); body.name = 'portraitBody'; body.position.y = neckY * 0.43;
  const head = new Bone(); head.name = 'portraitHead'; head.position.y = neckY - body.position.y;
  scene.add(root); root.add(body); body.add(head);

  // Continuous triangulation keeps hair crossing the torso from tearing at a layer seam.
  const geometry = new PlaneGeometry(height * aspect, height, 28, 36).translate(0, height / 2, 0);
  const positions = geometry.attributes.position;
  const joints = new Uint16Array(positions.count * 4);
  const weights = new Float32Array(positions.count * 4);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) / (height * aspect / 2);
    const y = positions.getY(i);
    const y01 = MathUtils.clamp(y / height, 0, 1);
    // Shallow curvature adds slight parallax, without changing the orthographic rest silhouette.
    positions.setZ(i, 0.085 * (1 - x * x) * Math.sin(Math.PI * y01));
    const headWeight = MathUtils.smoothstep(y, neckY - height * 0.14, neckY + height * 0.11);
    const rootWeight = (1 - headWeight) * (1 - MathUtils.smoothstep(y, 0.02, height * 0.3));
    joints.set([0, 1, 2, 0], i * 4);
    weights.set([rootWeight, 1 - rootWeight - headWeight, headWeight, 0], i * 4);
  }
  geometry.computeVertexNormals();
  geometry.setAttribute('skinIndex', new BufferAttribute(joints, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(weights, 4));
  const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
  const mesh = new SkinnedMesh(geometry, material);
  mesh.name = 'portraitMesh';
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  const skeleton = new Skeleton([root, body, head]);
  mesh.bind(skeleton);

  // Authored, periodic keys (identical first/last pose); compatible with glTF animation channels.
  const times = Array.from({ length: 49 }, (_, i) => (i / 48) * duration);
  const translation: number[] = [], stretch: number[] = [], tilt: number[] = [];
  const q = new Quaternion(), yaw = new Quaternion();
  for (const [i] of times.entries()) {
    const phase = i === 48 ? 0 : (2 * Math.PI * i) / 48;
    const jump = (1 - Math.cos(phase * 2)) / 2;
    const sway = Math.sin(phase);
    const spring = Math.sin(phase * 2);
    if (motion === 'nod') {
      translation.push(0, -0.025 * jump, 0);
      stretch.push(1, 1, 1);
      q.setFromAxisAngle(new Vector3(1, 0, 0), 0.25 * jump);
    } else {
      const wiggle = motion === 'wiggle';
      const side = wiggle ? spring : sway;
      translation.push((wiggle ? 0.075 : 0.045) * side, (wiggle ? 0.045 : 0.145) * jump, 0);
      stretch.push(1 - 0.035 * spring, 1 + 0.045 * spring, 1);
      q.setFromAxisAngle(depth, -0.12 * side).multiply(yaw.setFromAxisAngle(up, 0.105 * side));
    }
    q.toArray(tilt, tilt.length);
  }
  const animation = new AnimationClip(`Portrait ${motion}`, duration, [
    new VectorKeyframeTrack(`${root.name}.position`, times, translation),
    new VectorKeyframeTrack(`${root.name}.scale`, times, stretch),
    new QuaternionKeyframeTrack(`${head.name}.quaternion`, times, tilt),
  ]);
  return { scene, mesh, animation, dispose() { skeleton.dispose(); geometry.dispose(); material.dispose(); } };
}
