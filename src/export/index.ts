import { createPortraitRenderer } from '@/stage/portrait-renderer';
import type { PortraitScore } from '@/score/portrait';
import { portraitFrameSchedule } from '@/score/portrait-timing';
import type { PortraitFrames } from './encode-portrait';

function encode(input: PortraitFrames, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<Uint8Array<ArrayBuffer> | null>((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url));
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
    };
    const fail = () => { cleanup(); reject(new Error('GIF 编码失败，请重试。')); };
    const abort = () => { cleanup(); reject(signal.reason); };
    const timer = setTimeout(fail, 30_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = fail;
    worker.onmessage = ({ data }) => {
      if (data.oversized === true) { cleanup(); resolve(null); }
      else if (data.bytes instanceof Uint8Array) { cleanup(); resolve(data.bytes); }
      else fail();
    };
    try { worker.postMessage(input, input.frames); } catch { fail(); }
  });
}

export async function exportGif(image: HTMLCanvasElement, neck: number, score: PortraitScore, signal: AbortSignal) {
  const presets = [{ size: 320, delay: 100, colors: 192 }, { size: 240, delay: 120, colors: 128 }];
  for (const preset of presets) {
    signal.throwIfAborted();
    const { size, delay } = preset;
    const renderer = createPortraitRenderer(image, neck, score, size, true);
    const frames: ArrayBuffer[] = [];
    const samples = portraitFrameSchedule(score, delay);
    try {
      for (const [i, sample] of samples.entries()) {
        signal.throwIfAborted();
        renderer.draw(sample.time);
        frames.push(renderer.readFrame().data.buffer);
        if (i % 4 === 3) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    } finally { renderer.dispose(); }
    const bytes = await encode({ ...preset, delay: samples.map(sample => sample.delay), frames }, signal);
    if (bytes) return { blob: new Blob([bytes], { type: 'image/gif' }), size };
  }
  throw new Error('这张图的动画超过 1 MiB，请换一张背景或细节更简单的角色图。');
}
