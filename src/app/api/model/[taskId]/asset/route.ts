import { NextRequest } from 'next/server';
import { failure, guard, HttpError } from '@/server/http';
import { taskId, taskSchema, tripo } from '@/server/tripo';

export const runtime = 'nodejs';
export async function GET(request: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  try {
    guard(request, 20);
    const id = taskId.safeParse((await context.params).taskId);
    if (!id.success) throw new HttpError(400, '任务编号无效');
    const task = taskSchema.parse(await tripo(`/v3/tasks/${id.data}`, request.signal));
    if (task.status !== 'success' || !task.output?.model_url) throw new HttpError(409, '模型尚未生成完成');
    const url = new URL(task.output.model_url);
    if (url.protocol !== 'https:') throw new HttpError(502, '模型下载地址无效');
    const response = await fetch(url, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]), redirect: 'error', cache: 'no-store' });
    if (!response.ok || !response.body) throw new HttpError(502, '模型文件下载失败');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 100 * 1024 * 1024) { await reader.cancel(); throw new HttpError(413, '模型文件超过 100 MB'); }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
      throw new HttpError(502, '上游未返回有效的 GLB 模型');
    }
    return new Response(bytes, { headers: { 'Content-Type': 'model/gltf-binary', 'Content-Disposition': `attachment; filename="paji-${id.data}.glb"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) { return failure(error); }
}
