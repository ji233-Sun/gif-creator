import { fitMaskInput, measureAlpha } from './portrait-alpha';

export type PortraitImage = { canvas: HTMLCanvasElement; original: HTMLCanvasElement; source: 'alpha' | 'segmentation' };

function context2D(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法处理这张图片。');
  return { canvas, context };
}

async function segment(canvas: HTMLCanvasElement, signal: AbortSignal) {
  const bitmap = await createImageBitmap(canvas);
  return new Promise<{ alpha: Uint8ClampedArray; size: number }>((resolve, reject) => {
    let worker: Worker;
    try {
      signal.throwIfAborted();
      worker = new Worker(new URL('./portrait-mask-worker.ts', import.meta.url));
    } catch (error) { bitmap.close(); reject(error); return; }
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => { cleanup(); reject(signal.reason); };
    const fail = (message: string) => { cleanup(); reject(new Error(message)); };
    const timer = setTimeout(() => fail('本地抠图超时，请换一张透明底图再试。'), 45_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (!(data.alpha instanceof Uint8ClampedArray) || data.size !== 320 || data.alpha.length !== 320 ** 2) {
        fail(typeof data.error === 'string' ? data.error : '没有得到有效的前景。');
        return;
      }
      cleanup(); resolve(data);
    };
    worker.onerror = () => fail('无法启动本地抠图，请试试透明底图片。');
    try { worker.postMessage(bitmap, [bitmap]); }
    catch { bitmap.close(); fail('无法把图片交给本地抠图。'); }
  });
}

export async function preparePortrait(file: File, signal: AbortSignal): Promise<PortraitImage> {
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
  const full = context2D(width, height);
  try { full.context.drawImage(bitmap, 0, 0, width, height); } finally { bitmap.close(); }
  signal.throwIfAborted();
  const stats = () => measureAlpha(full.context.getImageData(0, 0, width, height).data, width, height);
  let info = stats();
  let source: PortraitImage['source'] = 'alpha';
  let untouched = full.canvas;
  if (!info.hasClearBorder) {
    const { alpha, size } = await segment(full.canvas, signal);
    signal.throwIfAborted();
    const mask = context2D(size, size);
    const pixels = mask.context.createImageData(size, size);
    for (let i = 0; i < alpha.length; i++) pixels.data[i * 4 + 3] = alpha[i];
    mask.context.putImageData(pixels, 0, 0);
    const retained = context2D(width, height);
    retained.context.drawImage(full.canvas, 0, 0);
    untouched = retained.canvas;
    full.context.globalCompositeOperation = 'destination-in';
    full.context.imageSmoothingQuality = 'high';
    const { x, y, w, h } = fitMaskInput(width, height, size);
    full.context.drawImage(mask.canvas, x, y, w, h, 0, 0, width, height);
    info = stats(); source = 'segmentation';
    if (info.coverage < 0.035 || info.coverage > 0.94) throw new Error('本地抠图没能可靠地区分角色和背景。请试试轮廓清晰或已抠好的透明底图。');
  }
  const pad = source === 'segmentation' ? Math.ceil(Math.max(info.right - info.left, info.bottom - info.top) * 0.04) : 2;
  const left = Math.max(0, info.left - pad), top = Math.max(0, info.top - pad);
  const w = Math.min(width - 1, info.right + pad) - left + 1;
  const h = Math.min(height - 1, info.bottom + pad) - top + 1;
  if (info.coverage < 0.005 || w < 16 || h < 16 || w / h < 0.1 || w / h > 5) throw new Error('没有找到尺寸合适的角色。');
  const cropped = context2D(w, h);
  cropped.context.drawImage(full.canvas, left, top, w, h, 0, 0, w, h);
  const original = source === 'alpha' ? cropped : context2D(w, h);
  if (source !== 'alpha') original.context.drawImage(untouched, left, top, w, h, 0, 0, w, h);
  return { canvas: cropped.canvas, original: original.canvas, source };
}
