import { GIFEncoder, applyPalette, quantize } from 'gifenc';

export const maxGifBytes = 1024 * 1024;
export type PortraitFrames = { size: number; delay: number | number[]; frames: ArrayBuffer[]; colors: number };

/** One global palette minimizes per-frame color flicker. Index zero is reserved for GIF transparency. */
export function encodePortrait({ size, delay, frames, colors }: PortraitFrames) {
  const length = size * size * 4;
  const delays = typeof delay === 'number' ? Array<number>(frames.length).fill(delay) : delay;
  if (!Number.isInteger(size) || size < 16 || size > 360 || frames.length < 2 || frames.length > 30 ||
    frames.some(frame => frame.byteLength !== length) || delays.length !== frames.length ||
    delays.some(ms => !Number.isInteger(ms) || ms % 10 !== 0 || ms < 30 || ms > 200) ||
    !Number.isInteger(colors) || colors < 40 || colors > 255) throw new Error('Invalid GIF settings');
  const rgba = frames.map(frame => new Uint8Array(frame));
  const sample = new Uint8Array(Math.ceil(size * size / 13) * rgba.length * 4);
  let count = 0;
  for (const frame of rgba) for (let i = 0; i < frame.length; i += 13 * 4) {
    if (frame[i + 3] < 128) continue;
    sample.set(frame.subarray(i, i + 4), count);
    count += 4;
  }
  if (!count) throw new Error('No visible GIF frames');
  const palette = quantize(sample.subarray(0, count), colors, { format: 'rgb565' });
  const gif = GIFEncoder();
  for (const [step, frame] of rgba.entries()) {
    const indices = applyPalette(frame, palette, 'rgb565');
    for (let i = 0; i < indices.length; i++) indices[i] = frame[i * 4 + 3] < 128 ? 0 : indices[i] + 1;
    gif.writeFrame(indices, size, size, {
      palette: step === 0 ? [[0, 0, 0], ...palette] : undefined,
      transparent: true, transparentIndex: 0, delay: delays[step], repeat: 0, dispose: 2,
    });
  }
  gif.finish();
  return gif.bytes();
}
