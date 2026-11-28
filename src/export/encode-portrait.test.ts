// @vitest-environment node
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { encodePortrait } from './encode-portrait';

it('writes a looping transparent GIF without leaving prior frames behind', async () => {
  const size = 16;
  const frame = (start: number, color: number[]) => {
    const rgba = new Uint8Array(size * size * 4);
    for (let y = 3; y < 13; y++) for (let x = start; x < start + 5; x++) rgba.set(color, (y * size + x) * 4);
    return rgba.buffer;
  };
  const bytes = encodePortrait({ size, delay: [70, 130], frames: [frame(2, [205, 85, 68, 255]), frame(8, [62, 107, 235, 255])], colors: 64 });
  const image = sharp(bytes, { animated: true });
  expect(await image.metadata()).toMatchObject({ format: 'gif', width: size, pageHeight: size, pages: 2, delay: [70, 130], loop: 0, hasAlpha: true });
  const data = await image.ensureAlpha().raw().toBuffer();
  const alpha = (page: number, x: number, y: number) => data[((page * size + y) * size + x) * 4 + 3];
  expect(alpha(0, 4, 7)).toBe(255);
  expect(alpha(1, 4, 7)).toBe(0);
  expect(alpha(1, 10, 7)).toBe(255);
  expect(alpha(1, 0, 0)).toBe(0);
});

it('rejects invalid frame dimensions and completely transparent takes', () => {
  expect(() => encodePortrait({ size: 360, delay: 100, frames: [new ArrayBuffer(1), new ArrayBuffer(1)], colors: 128 })).toThrow('Invalid GIF settings');
  const clear = new ArrayBuffer(16 * 16 * 4);
  expect(() => encodePortrait({ size: 16, delay: 100, frames: [clear, clear], colors: 128 })).toThrow('No visible GIF frames');
});
