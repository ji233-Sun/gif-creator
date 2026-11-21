'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

function dispose(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  root.traverse(object => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        material.dispose();
      }
    }
    if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
  });
  textures.forEach(texture => texture.dispose());
}

export function ModelStage({ blob, skeleton, onInfo, onError }: { blob: Blob | null; skeleton: boolean; onInfo: (info: { bones: number; meshes: number }) => void; onError: (message: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const helper = useRef<THREE.SkeletonHelper | null>(null);
  const infoCallback = useRef(onInfo);
  const errorCallback = useRef(onError);
  const [failure, setFailure] = useState<{ blob: Blob | null; message: string } | null>(null);
  const showSkeleton = useRef(skeleton);
  useEffect(() => { infoCallback.current = onInfo; errorCallback.current = onError; }, [onInfo, onError]);
  useEffect(() => {
    showSkeleton.current = skeleton;
    if (helper.current) helper.current.visible = skeleton;
  }, [skeleton]);

  useEffect(() => {
    const element = host.current!;
    let active = true;
    function reportFailure(message: string) {
      if (!active) return;
      setFailure({ blob, message });
      errorCallback.current(message);
    }
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch {
      queueMicrotask(() => reportFailure('无法启动 3D 预览，请检查浏览器的 WebGL 支持'));
      return () => { active = false; };
    }
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    camera.position.set(3.6, 2.6, 4.6);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-label', '角色三维预览，可拖动旋转、滚轮缩放');
    element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0); controls.enableDamping = true;
    controls.minDistance = 1; controls.maxDistance = 12;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x63647d, 3));
    const light = new THREE.DirectionalLight(0xffffff, 4); light.position.set(3, 6, 4); scene.add(light);
    const grid = new THREE.GridHelper(8, 20, 0xa7a3b6, 0xd9d7e0); scene.add(grid);
    const actor = new THREE.Group(); scene.add(actor);
    const loader = new GLTFLoader();
    const draco = new DRACOLoader().setDecoderPath('/draco/');
    loader.setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
    let mixer: THREE.AnimationMixer | null = null;
    let lastFrame = 0;
    if (blob) {
      blob.arrayBuffer().then(bytes => {
        if (!active) return;
        return loader.parseAsync(bytes, '');
      }).then(gltf => {
        if (!gltf) return;
        if (!active) { dispose(gltf.scene); return; }
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const scale = 2 / Math.max(size.x, size.y, size.z, 0.001);
        const center = box.getCenter(new THREE.Vector3());
        model.scale.multiplyScalar(scale);
        model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z).multiplyScalar(scale));
        actor.add(model);
        let meshes = 0;
        const bones = new Set<THREE.Bone>();
        model.traverse(node => {
          if (node instanceof THREE.Mesh) meshes++;
          if (node instanceof THREE.SkinnedMesh) node.skeleton.bones.forEach(bone => bones.add(bone));
        });
        helper.current = new THREE.SkeletonHelper(model);
        helper.current.visible = showSkeleton.current;
        for (const material of Array.isArray(helper.current.material) ? helper.current.material : [helper.current.material]) material.depthTest = false;
        scene.add(helper.current);
        if (gltf.animations.length) { mixer = new THREE.AnimationMixer(model); mixer.clipAction(gltf.animations[0]).play(); }
        infoCallback.current({ bones: bones.size, meshes });
      }).catch(() => reportFailure('GLB 模型加载失败，请重试下载或检查模型格式'));
    }
    const resize = new ResizeObserver(() => {
      const width = element.clientWidth, height = element.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
    });
    resize.observe(element);
    renderer.setAnimationLoop(time => {
      if (lastFrame) mixer?.update(Math.min((time - lastFrame) / 1000, 0.1));
      lastFrame = time; controls.update(); renderer.render(scene, camera);
    });
    return () => {
      active = false; renderer.setAnimationLoop(null); resize.disconnect(); controls.dispose(); mixer?.stopAllAction();
      if (helper.current) { helper.current.dispose(); helper.current = null; }
      dispose(actor); grid.geometry.dispose();
      for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) material.dispose();
      draco.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [blob]);
  return <div className="stage-canvas" ref={host}>{failure?.blob === blob && <p className="stage-error" role="alert">{failure.message}</p>}</div>;
}
