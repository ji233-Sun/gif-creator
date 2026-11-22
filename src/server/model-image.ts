import sharp from 'sharp';
import { MAX_IMAGE_PIXELS } from '@/lib/character-image';
import { HttpError } from './http';

const unreadable = () => new HttpError(400, '图片无法读取或像素数过大，请换一张有效的角色图。');
const decode = (bytes: Buffer) => sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' });

export async function validateImagePixels(bytes: Buffer) {
  try { await decode(bytes).stats(); }
  catch { throw unreadable(); }
}
