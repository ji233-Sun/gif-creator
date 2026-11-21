// libfx 0.0.17 allows at most 5 MiB of base64 for a single image.
const MAX_DIRECTOR_BYTES = (5 * 1024 * 1024 / 4) * 3;

export async function directorImage(file: File, signal: AbortSignal) {
  signal.throwIfAborted();
  let image: Blob = file;
  if (file.size > MAX_DIRECTOR_BYTES) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    try {
      signal.throwIfAborted();
      // At this size even an incompressible RGBA PNG fits the director limit.
      const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法为 AI 导演缩放图片');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      image = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法为 AI 导演压缩图片')), 'image/png');
      });
      if (image.size > MAX_DIRECTOR_BYTES) throw new Error('压缩后的导演预览图仍过大，请换一张角色图');
    } finally {
      bitmap.close();
      canvas.width = canvas.height = 0;
    }
  }
  signal.throwIfAborted();
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(image);
  });
  signal.throwIfAborted();
  return { type: 'image' as const, data, mimeType: image.type };
}
