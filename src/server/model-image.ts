import sharp from 'sharp';
import { characterImageType, MAX_IMAGE_PIXELS } from '@/lib/character-image';
import { HttpError } from './http';

const unreadable = () => new HttpError(400, '图片无法读取或像素数过大，请换一张有效的角色图。');
const decode = (bytes: Buffer) => sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' });

export async function validateImagePixels(bytes: Buffer) {
  try { await decode(bytes).stats(); }
  catch { throw unreadable(); }
}

export async function tripoImage(file: File) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = characterImageType(bytes);
  if (!type || file.type !== type) throw new HttpError(400, '仅支持有效的 PNG、JPEG 或 WebP 图片');
  if (type !== 'image/webp') {
    await validateImagePixels(bytes);
    return file;
  }
  try {
    // Tripo /v3/files only advertises PNG and JPEG. Preserve alpha and stay
    // under its 20 MB limit even for an incompressible RGBA image.
    const png = await decode(bytes).rotate().resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    return new File([new Uint8Array(png)], 'character.png', { type: 'image/png' });
  } catch { throw unreadable(); }
}
