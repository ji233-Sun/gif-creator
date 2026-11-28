import * as ort from 'onnxruntime-web/wasm';
import { confidenceToAlpha, fitMaskInput, repairForegroundHoles } from './portrait-alpha';

const size = 320;
const length = size * size;
const root = new URL('/portrait-model/', self.location.origin);
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = root.href;

self.addEventListener('message', async ({ data: bitmap }: MessageEvent<ImageBitmap>) => {
  try {
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas unavailable');
    const { x, y, w, h } = fitMaskInput(bitmap.width, bitmap.height, size);
    // Extend the edge pixels into the letterbox rather than inject a new hard background.
    if (x) context.drawImage(bitmap, 0, 0, 1, bitmap.height, 0, 0, x, size);
    if (x + w < size) context.drawImage(bitmap, bitmap.width - 1, 0, 1, bitmap.height, x + w, 0, size - x - w, size);
    if (y) context.drawImage(bitmap, 0, 0, bitmap.width, 1, 0, 0, size, y);
    if (y + h < size) context.drawImage(bitmap, 0, bitmap.height - 1, bitmap.width, 1, 0, y + h, size, size - y - h);
    context.drawImage(bitmap, x, y, w, h);
    const rgba = context.getImageData(0, 0, size, size).data;
    const values = new Float32Array(length * 3);
    const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    for (let c = 0; c < 3; c++) for (let i = 0; i < length; i++) values[c * length + i] = (rgba[i * 4 + c] / 255 - mean[c]) / std[c];
    // Fetch only the static model bytes. Pixels never leave this Worker.
    const response = await fetch(new URL('u2netp.onnx', root));
    if (!response.ok) throw new Error('Segmentation assets not installed');
    const model = await response.arrayBuffer();
    if (model.byteLength !== 4_574_861) throw new Error('Wrong segmentation asset version');
    const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
    const tensor = new ort.Tensor('float32', values, [1, 3, size, size]);
    try {
      const output = session.outputNames[0];
      const result = (await session.run({ [session.inputNames[0]]: tensor }, [output]))[output];
      try {
        if (result.type !== 'float32') throw new Error('Unexpected foreground mask format');
        const alpha = confidenceToAlpha(result.data as Float32Array, length);
        repairForegroundHoles(alpha, rgba, size);
        self.postMessage({ alpha, size }, { transfer: [alpha.buffer] });
      } finally { result.dispose(); }
    } finally { tensor.dispose(); await session.release(); }
  } catch {
    self.postMessage({ error: '无法在本机抠图。请确认站点已准备抠图资源，或尝试上传透明底图。' });
  } finally { bitmap.close(); }
});
