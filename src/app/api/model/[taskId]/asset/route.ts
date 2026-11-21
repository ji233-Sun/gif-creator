import { NextRequest } from 'next/server';
import { taskFailed } from '@/model/provider';
import { failure, guard, HttpError } from '@/server/http';
import { readModelRef } from '@/server/model-access';
import { readTripoTask, TripoTaskUnavailableError } from '@/server/tripo';

export const runtime = 'nodejs';
const unusable = (status: number, message: string) => failure(new HttpError(status, message), { asset: 'unusable' });
export async function GET(request: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  try {
    guard(request, 20, '/api/model/:taskId/asset');
    const { id, phase } = readModelRef(request, (await context.params).taskId);
    if (phase === 'check') throw new HttpError(404, '该任务没有 GLB 文件');
    const task = await readTripoTask(id, request.signal);
    if (taskFailed(task.status)) return unusable(410, 'Tripo 任务已结束，原模型文件不再可用。');
    if (task.status !== 'success') throw new HttpError(409, '模型尚未生成完成');
    if (!task.output?.model_url) return unusable(409, 'Tripo 未提供可下载的模型文件。');
    let url: URL;
    try { url = new URL(task.output.model_url); }
    catch { return unusable(502, 'Tripo 返回的模型下载地址无效。'); }
    if (url.protocol !== 'https:' || url.username || url.password) return unusable(502, 'Tripo 返回的模型下载地址无效。');
    const response = await fetch(url, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]), redirect: 'error', cache: 'no-store' });
    if (response.status === 404 || response.status === 410) return unusable(410, 'Tripo 模型文件不再可用。');
    if (response.status === 403) return unusable(403, 'Tripo 模型文件暂不可访问，请先重试下载。');
    if (!response.ok || !response.body) throw new HttpError(502, '模型文件下载失败');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 100 * 1024 * 1024) { await reader.cancel(); return unusable(413, '模型文件超过 100 MB'); }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
      return unusable(502, '上游未返回有效的 GLB 模型');
    }
    return new Response(bytes, { headers: { 'Content-Type': 'model/gltf-binary', 'Content-Disposition': `attachment; filename="paji-${id}.glb"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return error instanceof TripoTaskUnavailableError ? unusable(410, error.message) : failure(error);
  }
}
