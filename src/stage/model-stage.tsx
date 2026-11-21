'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { hasRenderableTriangle } from './geometry';

export type ModelInfo = { bones: number; meshes: number };
export type StageLoadFailure = { message: string; unusable?: boolean };

function dispose(gltf: GLTF) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  for (const root of new Set([gltf.scene, ...gltf.scenes])) root.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  const bitmaps = new Set<ImageBitmap>();
  for (const texture of textures) {
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) bitmaps.add(texture.image);
    texture.dispose();
  }
  bitmaps.forEach(bitmap => bitmap.close());
  skeletons.forEach(skeleton => skeleton.dispose());
  geometries.forEach(geometry => geometry.dispose());
}

function createStage(element: HTMLDivElement, onLost: () => void, onRestored: () => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  camera.position.set(3.6, 2.6, 4.6);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', '角色三维预览，可拖动旋转、滚轮缩放');
  renderer.domElement.addEventListener('webglcontextlost', onLost);
  renderer.domElement.addEventListener('webglcontextrestored', onRestored);
  element.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1, 0); controls.enableDamping = true;
  controls.minDistance = 1; controls.maxDistance = 12;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x63647d, 3));
  const light = new THREE.DirectionalLight(0xffffff, 4); light.position.set(3, 6, 4); scene.add(light);
  const grid = new THREE.GridHelper(8, 20, 0xa7a3b6, 0xd9d7e0); scene.add(grid);
  const loader = new GLTFLoader();
  const draco = new DRACOLoader().setDecoderPath('/draco/');
  loader.setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  let current: { blob: Blob; gltf: GLTF; helper: THREE.SkeletonHelper; mixer?: THREE.AnimationMixer } | undefined;
  let lastFrame = 0;
  let visible = false;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const resize = new ResizeObserver(() => {
    const width = element.clientWidth, height = element.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
  });
  resize.observe(element);
  function frame(time: number) {
    if (lastFrame && !reducedMotion.matches) current?.mixer?.update(Math.min((time - lastFrame) / 1000, 0.1));
    lastFrame = time; controls.update(); renderer.render(scene, camera);
  }
  function clear() {
    if (!current) return;
    current.mixer?.stopAllAction();
    scene.remove(current.helper, current.gltf.scene);
    current.helper.dispose();
    dispose(current.gltf);
    current = undefined;
  }
  return {
    loader,
    get blob() { return current?.blob; },
    get lost() { return renderer.getContext().isContextLost(); },
    setVisible(next: boolean) {
      if (next === visible) return;
      visible = next;
      lastFrame = 0;
      renderer.setAnimationLoop(next ? frame : null);
    },
    showSkeleton(visible: boolean) { if (current) current.helper.visible = visible; },
    replace(blob: Blob, gltf: GLTF, showSkeleton: boolean, accept: () => boolean) {
      const model = gltf.scene;
      const helper = new THREE.SkeletonHelper(model);
      helper.visible = showSkeleton;
      for (const material of Array.isArray(helper.material) ? helper.material : [helper.material]) material.depthTest = false;
      const mixer = gltf.animations.length ? new THREE.AnimationMixer(model) : undefined;
      if (!accept()) { helper.dispose(); return false; }
      mixer?.clipAction(gltf.animations[0]).play();
      clear();
      scene.add(model, helper);
      current = { blob, gltf, helper, mixer };
      return true;
    },
    dispose() {
      renderer.setAnimationLoop(null); resize.disconnect(); controls.dispose(); clear();
      grid.geometry.dispose();
      for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) material.dispose();
      draco.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onRestored);
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
}

export function ModelStage({ blob, rigged, skeleton, visible, onInfo, onError }: {
  blob: Blob;
  rigged: boolean;
  skeleton: boolean;
  visible: boolean;
  onInfo: (blob: Blob, info: ModelInfo) => boolean;
  onError: (blob: Blob, failure: StageLoadFailure) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<ReturnType<typeof createStage> | null>(null);
  const callbacks = useRef({ onInfo, onError });
  const showSkeleton = useRef(skeleton);
  const [contextLost, setContextLost] = useState(false);
  const [failure, setFailure] = useState<{ blob: Blob; message: string } | null>(null);
  useEffect(() => { callbacks.current = { onInfo, onError }; }, [onInfo, onError]);
  useEffect(() => {
    showSkeleton.current = skeleton;
    stage.current?.showSkeleton(skeleton);
  }, [skeleton]);
  useEffect(() => {
    try { stage.current = createStage(host.current!, () => setContextLost(true), () => setContextLost(false)); }
    catch { /* The active load reports WebGL initialization failure. */ }
    return () => { stage.current?.dispose(); stage.current = null; };
  }, []);
  useEffect(() => { stage.current?.setVisible(visible && !contextLost); }, [visible, contextLost]);
  useEffect(() => {
    const current = stage.current;
    if (current?.blob === blob) return;
    let active = true;
    function reportFailure(message: string, unusable = false) {
      if (!active) return;
      setFailure({ blob, message });
      callbacks.current.onError(blob, { message, unusable });
    }
    if (!current) queueMicrotask(() => reportFailure('无法启动 3D 预览，请检查浏览器的 WebGL 支持'));
    else if (contextLost) queueMicrotask(() => reportFailure('3D 预览暂时不可用，请稍后重试。'));
    else void (async () => {
      let candidate: GLTF | undefined;
      try {
        const bytes = await blob.arrayBuffer();
        if (!active) return;
        const header = new DataView(bytes);
        if (bytes.byteLength < 20 || header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== bytes.byteLength) {
          return reportFailure('GLB 模型加载失败，文件格式不正确。', true);
        }
        candidate = await current.loader.parseAsync(bytes, '');
        if (!active) return;
        if (current.lost) return reportFailure('3D 预览暂时不可用，请稍后重试。');
        const model = candidate.scene;
        model.updateMatrixWorld(true);
        let meshes = 0;
        const bones = new Set<THREE.Bone>();
        model.traverseVisible(node => {
          if (!(node instanceof THREE.Mesh) || !hasRenderableTriangle(node)) return;
          meshes++;
          if (node instanceof THREE.SkinnedMesh) node.skeleton.bones.forEach(bone => bones.add(bone));
        });
        if (!meshes || (rigged && !bones.size)) return reportFailure('未检测到有效的模型网格或蒙皮骨骼。', true);
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const extent = Math.max(size.x, size.y, size.z);
        if (box.isEmpty() || !Number.isFinite(extent) || extent <= 0) return reportFailure('GLB 模型没有有效的预览范围。', true);
        const scale = 2 / Math.max(extent, 0.001);
        const center = box.getCenter(new THREE.Vector3());
        model.scale.multiplyScalar(scale);
        model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z).multiplyScalar(scale));
        if (current.replace(blob, candidate, showSkeleton.current, () => callbacks.current.onInfo(blob, { bones: bones.size, meshes }))) {
          candidate = undefined;
          setFailure(null);
        }
      } catch {
        if (current.lost) reportFailure('3D 预览暂时不可用，请稍后重试。');
        else reportFailure('GLB 模型加载失败。请先重试下载，再考虑重新提交。', true);
      }
      finally { if (candidate) dispose(candidate); }
    })();
    return () => { active = false; };
  }, [blob, rigged, contextLost]);
  const message = contextLost ? '3D 预览暂时不可用，请稍后重试。' : failure?.blob === blob ? failure.message : undefined;
  return <div className="stage-canvas" ref={host}>{message && <p className="stage-error" role="alert">{message}</p>}</div>;
}
