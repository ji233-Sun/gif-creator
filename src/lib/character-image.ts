export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 4096 * 4096;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export function characterImageType(bytes: Uint8Array) {
  const matches = (offset: number, signature: number[]) => signature.every((byte, index) => bytes[offset + index] === byte);
  if (matches(0, [137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
  if (matches(0, [255, 216, 255])) return 'image/jpeg';
  if (matches(0, [82, 73, 70, 70]) && matches(8, [87, 69, 66, 80])) return 'image/webp';
  return null;
}
