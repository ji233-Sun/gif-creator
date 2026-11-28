import { encodePortrait, maxGifBytes, type PortraitFrames } from './encode-portrait';

self.addEventListener('message', ({ data }: MessageEvent<PortraitFrames>) => {
  try {
    const bytes = encodePortrait(data);
    if (bytes.length > maxGifBytes) self.postMessage({ oversized: true });
    else self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch { self.postMessage({ error: true }); }
});
