// @vitest-environment node
import { expect, it } from 'vitest';
import { AnimationMixer, Texture, Vector3 } from 'three';
import { createPortraitRig } from './portrait-rig';

it('keeps the source proportions and UVs, blends the neck, and loops back to rest', () => {
  const texture = new Texture();
  const rig = createPortraitRig(texture, { width: 600, height: 800, neckFromTop: 0.5 });
  try {
    const { mesh, scene, animation } = rig;
    mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox!.getSize(new Vector3());
    expect(size.x / size.y).toBeCloseTo(0.75);
    expect(size.z).toBeGreaterThan(0);
    expect(mesh.material.map).toBe(texture);
    expect(mesh.material.toneMapped).toBe(false);
    const { uv, skinWeight } = mesh.geometry.attributes;
    expect([uv.getX(0), uv.getY(0)]).toEqual([0, 1]);
    expect(skinWeight.getZ(0)).toBe(1);
    const mid = Math.floor(skinWeight.count / 2);
    expect(skinWeight.getY(mid)).toBeGreaterThan(0);
    expect(skinWeight.getZ(mid)).toBeGreaterThan(0);
    expect(skinWeight.getX(skinWeight.count - 1)).toBe(1);
    for (let i = 0; i < skinWeight.count; i++) {
      expect(skinWeight.getX(i) + skinWeight.getY(i) + skinWeight.getZ(i)).toBeCloseTo(1, 6);
    }

    const mixer = new AnimationMixer(scene);
    mixer.clipAction(animation).play();
    const rest = mesh.getVertexPosition(0, new Vector3()).clone();
    mixer.setTime(animation.duration / 4);
    scene.updateMatrixWorld(true);
    expect(mesh.getVertexPosition(0, new Vector3()).distanceTo(rest)).toBeGreaterThan(0.1);
    mixer.setTime(animation.duration);
    scene.updateMatrixWorld(true);
    expect(mesh.getVertexPosition(0, new Vector3()).distanceTo(rest)).toBeLessThan(1e-5);
    mixer.stopAllAction();
    mixer.uncacheRoot(scene);
  } finally {
    rig.dispose();
    texture.dispose();
  }
});

it('rejects a missing image size or unusable anchor', () => {
  const texture = new Texture();
  expect(() => createPortraitRig(texture, { width: 0, height: 800, neckFromTop: 0.5 })).toThrow('Invalid portrait layout');
  expect(() => createPortraitRig(texture, { width: 100, height: 800, neckFromTop: 0 })).toThrow('Invalid portrait layout');
  texture.dispose();
});
