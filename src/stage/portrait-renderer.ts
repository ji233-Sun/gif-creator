import { CanvasTexture, OrthographicCamera, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { createPortraitRig } from '@/model/portrait-rig';
import { evaluatePortrait, isFaceChannel, type PortraitScore } from '@/score/portrait';
import { createFacePainter, paintPerformance } from './portrait-performance';

export function createPortraitRenderer(image: HTMLCanvasElement, neckFromTop: number, score: PortraitScore | null, size: number, capture = false) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: capture });
  if (!ctx) throw new Error('无法创建表情包画布。');
  const texture = new CanvasTexture(image);
  texture.colorSpace = SRGBColorSpace;
  const layout = (neck: number) => ({ width: image.width, height: image.height, neckFromTop: neck });
  let rig = createPortraitRig(texture, layout(neckFromTop));
  let renderer: WebGLRenderer;
  try { renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); }
  catch (error) { rig.dispose(); texture.dispose(); throw error; }
  renderer.setSize(size, size, false);
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  const extent = Math.max(1.39, image.width / image.height * 1.27 + 0.08);
  const camera = new OrthographicCamera(-extent, extent, extent, -extent, 0.01, 100);
  camera.position.set(0, 1.065, 5); camera.lookAt(0, 1.065, 0); camera.updateMatrixWorld();

  let painter: ReturnType<typeof createFacePainter> | undefined;
  let anchors = { head: 0, mouth: 0, body: 0 };
  const projected = new Vector3();
  function nearest(x: number, y: number) {
    const uv = rig.mesh.geometry.attributes.uv;
    let best = 0, distance = Infinity;
    for (let i = 0; i < uv.count; i++) {
      const d = (uv.getX(i) - x) ** 2 + (1 - uv.getY(i) - y) ** 2;
      if (d < distance) { best = i; distance = d; }
    }
    return best;
  }
  function prepareScore(next: PortraitScore | null) {
    score = next;
    painter = next?.face && next.tracks.some(track => isFaceChannel(track.channel))
      ? createFacePainter(image, next.face) : undefined;
    texture.image = painter?.canvas ?? image;
    texture.needsUpdate = true;
    const eye = next?.face?.leftEye;
    anchors = { head: nearest(0.5, eye ? Math.max(0.07, eye.y - 0.21) : 0.24),
      mouth: nearest(next?.face?.mouth.x ?? 0.5, next?.face?.mouth.y ?? 0.43), body: nearest(0.5, 0.61) };
  }
  const onLost = (event: Event) => { event.preventDefault(); canvas.dispatchEvent(new Event('webglcontextlost')); };
  renderer.domElement.addEventListener('webglcontextlost', onLost);
  function dispose() {
    renderer.domElement.removeEventListener('webglcontextlost', onLost);
    rig.dispose(); texture.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    canvas.width = canvas.height = 0;
  }
  try { prepareScore(score); } catch (error) { dispose(); throw error; }
  return {
    canvas, get duration() { return score?.duration ?? 1; },
    configure(neck: number, nextScore: PortraitScore | null) {
      if (neckFromTop !== neck) {
        const next = createPortraitRig(texture, layout(neck));
        rig.dispose(); rig = next; neckFromTop = neck;
      }
      if (score !== nextScore) prepareScore(nextScore);
    },
    draw(time: number) {
      if (renderer.getContext().isContextLost()) throw new Error('WebGL 已中断，请重试。');
      const frame = evaluatePortrait(score, time);
      const { pose } = frame;
      if (painter?.draw(pose.squint, pose.gaze, pose.blink, pose.mouth)) texture.needsUpdate = true;
      const [root, , head] = rig.mesh.skeleton.bones;
      root.position.set(pose.x * 0.22, pose.y * 0.27, 0);
      root.rotation.z = -pose.tilt * 0.29;
      root.scale.set(1 + pose.squash * 0.13, 1 - pose.squash * 0.16, 1);
      head.rotation.set(pose.nod * 0.26, pose.turn * 0.20, -pose.headTilt * 0.22);
      renderer.render(rig.scene, camera);
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(renderer.domElement, 0, 0);
      paintPerformance(ctx, size, frame, anchor => {
        rig.mesh.getVertexPosition(anchors[anchor], projected).applyMatrix4(rig.mesh.matrixWorld).project(camera);
        return { x: (projected.x + 1) / 2, y: (1 - projected.y) / 2 };
      });
    },
    readFrame() { return ctx.getImageData(0, 0, size, size); },
    dispose,
  };
}
