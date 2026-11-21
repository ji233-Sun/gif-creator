import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { failure, guard, HttpError, readJson } from '@/server/http';
import { imageFormat, taskId, taskSchema, tripo } from '@/server/tripo';

export const runtime = 'nodejs';
const actionSchema = z.object({ action: z.enum(['check', 'rig']), taskId });

export async function GET(request: NextRequest) {
  try {
    guard(request, 120);
    const id = taskId.safeParse(request.nextUrl.searchParams.get('taskId'));
    if (!id.success) throw new HttpError(400, '任务编号无效');
    const task = taskSchema.parse(await tripo(`/v3/tasks/${id.data}`, request.signal));
    return NextResponse.json(task, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    guard(request, 10);
    let result: unknown;
    if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
      const max = 10 * 1024 * 1024;
      // Count multipart overhead as well, before parsing an untrusted upload.
      const reader = request.body?.getReader();
      if (!reader) throw new HttpError(400, '请上传图片');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > max + 64 * 1024) { await reader.cancel(); throw new HttpError(413, '图片不能超过 10 MB'); }
        chunks.push(value);
      }
      const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData();
      const file = form.get('image');
      if (!(file instanceof File) || file.size === 0) throw new HttpError(400, '请上传图片');
      if (file.size > max) throw new HttpError(413, '图片不能超过 10 MB');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const format = imageFormat(bytes);
      if (!format || format !== file.type) throw new HttpError(400, '仅支持有效的 PNG、JPEG 或 WebP 图片');
      const upload = new FormData();
      upload.set('file', file, `character.${format === 'image/jpeg' ? 'jpg' : format.split('/')[1]}`);
      const { file_token } = z.object({ file_token: z.string().min(1) }).parse(await tripo('/v3/files', request.signal, upload));
      result = await tripo('/v3/generation/image-to-model', request.signal, { input: file_token, model: process.env.TRIPO_MODEL ?? 'v2.5-20250123', texture: true, pbr: true });
    } else {
      const parsed = actionSchema.safeParse(await readJson(request, 4096));
      if (!parsed.success) throw new HttpError(400, '任务参数无效');
      const { action, taskId: input } = parsed.data;
      result = await tripo(action === 'check' ? '/v3/animations/rig-check' : '/v3/animations/rig', request.signal,
        action === 'check' ? { input } : { input, model: process.env.TRIPO_RIG_MODEL ?? 'v2.5-20260210', out_format: 'glb' });
    }
    return NextResponse.json(z.object({ task_id: taskId }).parse(result));
  } catch (error) { return failure(error); }
}
