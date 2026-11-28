import { expect, it } from 'vitest';
import { confidenceToAlpha, fitMaskInput, measureAlpha, repairForegroundHoles } from './portrait-alpha';

it('letterboxes the source without stretching horizontal or vertical inputs', () => {
  expect(fitMaskInput(550, 480, 320)).toEqual({ x: 0, y: 20, w: 320, h: 279 });
  expect(fitMaskInput(200, 800, 320)).toEqual({ x: 120, y: 0, w: 80, h: 320 });
});

it('keeps original transparent framing and finds foreground bounds', () => {
  const pixels = new Uint8ClampedArray(5 * 4 * 4);
  pixels[(1 * 5 + 2) * 4 + 3] = 255;
  pixels[(2 * 5 + 3) * 4 + 3] = 64;
  expect(measureAlpha(pixels, 5, 4)).toEqual({ left: 2, right: 3, top: 1, bottom: 2, coverage: 0.05, hasClearBorder: true });
  expect(measureAlpha(pixels.fill(255), 5, 4)).toEqual({ left: 0, right: 4, top: 0, bottom: 3, coverage: 1, hasClearBorder: false });
});

it('rejects missing, flat, and non-finite foreground masks', () => {
  expect(() => confidenceToAlpha(new Float32Array([0, 1]), 3)).toThrow();
  expect(() => confidenceToAlpha(new Float32Array([0.6, 0.61]), 2)).toThrow();
  expect(() => confidenceToAlpha(new Float32Array([0, NaN]), 2)).toThrow();
  expect([...confidenceToAlpha(new Float32Array([0, 0.5, 1]), 3)]).toEqual([0, 128, 255]);
});

it('repairs enclosed dropouts with foreground colors but keeps contrasting holes', () => {
  const size = 32;
  const alpha = new Uint8ClampedArray(size ** 2).fill(255);
  const rgba = new Uint8ClampedArray(alpha.length * 4);
  for (let i = 0; i < alpha.length; i++) rgba.set([50, 82, 177, 255], i * 4);
  const dropout = size * 13 + 12, gap = size * 19 + 16;
  alpha[dropout] = 0;
  alpha[gap] = 0;
  rgba.set([236, 196, 153, 255], gap * 4);
  alpha[0] = 0; // an edge belongs to the background, even if the colors match
  repairForegroundHoles(alpha, rgba, size);
  expect([alpha[dropout], alpha[gap], alpha[0]]).toEqual([255, 0, 0]);
});
