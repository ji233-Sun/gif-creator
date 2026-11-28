export function fitMaskInput(width: number, height: number, size: number) {
  const scale = size / Math.max(width, height);
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  return { x: Math.floor((size - w) / 2), y: Math.floor((size - h) / 2), w, h };
}

export function measureAlpha(data: Uint8ClampedArray, width: number, height: number) {
  let left = width, right = -1, top = height, bottom = -1;
  let solid = 0, clearBorder = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = data[(y * width + x) * 4 + 3];
    if (alpha >= 128) solid++;
    if (alpha < 16 && (x === 0 || y === 0 || x === width - 1 || y === height - 1)) clearBorder++;
    if (alpha < 24) continue;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return { left, right, top, bottom, coverage: solid / (width * height), hasClearBorder: clearBorder >= (width + height) * 0.1 };
}

/** Convert model confidence to alpha; reject invalid/malformed or practically constant masks. */
export function confidenceToAlpha(data: Float32Array, length: number) {
  if (data.length !== length) throw new Error('Invalid foreground mask dimensions');
  let min = Infinity, max = -Infinity;
  for (const value of data) { min = Math.min(min, value); max = Math.max(max, value); }
  if (!Number.isFinite(max - min) || max - min < 0.05) throw new Error('Foreground mask has no usable separation');
  const alpha = new Uint8ClampedArray(data.length);
  for (let i = 0; i < alpha.length; i++) alpha[i] = 255 * Math.max(0, Math.min(1, ((data[i] - min) / (max - min) - 0.18) / 0.64));
  return alpha;
}

/** Repair small, enclosed mask dropouts only when their source colors agree with adjacent foreground. */
export function repairForegroundHoles(alpha: Uint8ClampedArray, rgba: Uint8ClampedArray, size: number) {
  const visited = new Uint8Array(alpha.length);
  const threshold = 160, maxArea = Math.floor(alpha.length * 0.016);
  for (let seed = 0; seed < alpha.length; seed++) {
    if (visited[seed] || alpha[seed] >= threshold) continue;
    const region = [seed], boundary = new Set<number>();
    visited[seed] = 1;
    let touchesEdge = false;
    for (let i = 0; i < region.length; i++) {
      const pixel = region[i], x = pixel % size, y = Math.floor(pixel / size);
      if (!x || !y || x === size - 1 || y === size - 1) touchesEdge = true;
      const neighbors = [x > 0 ? pixel - 1 : -1, x < size - 1 ? pixel + 1 : -1, pixel - size, pixel + size];
      for (const next of neighbors) {
        if (next < 0 || next >= alpha.length) continue;
        if (alpha[next] >= threshold) {
          if (!touchesEdge && region.length <= maxArea && alpha[next] >= 220) boundary.add(next);
        } else if (!visited[next]) {
          visited[next] = 1;
          region.push(next);
        }
      }
    }
    if (touchesEdge || !boundary.size || region.length > maxArea) continue;
    const rim = [...boundary].filter((_, i) => i % Math.ceil(boundary.size / 32) === 0);
    let matches = 0, samples = 0;
    for (let i = 0; i < region.length; i += Math.ceil(region.length / 64)) {
      const a = region[i] * 4;
      samples++;
      if (rim.some(pixel => {
        const b = pixel * 4;
        return Math.abs(rgba[a] - rgba[b]) + Math.abs(rgba[a + 1] - rgba[b + 1]) + Math.abs(rgba[a + 2] - rgba[b + 2]) < 45;
      })) matches++;
    }
    if (matches / samples >= 0.86) for (const pixel of region) alpha[pixel] = 255;
  }
}

