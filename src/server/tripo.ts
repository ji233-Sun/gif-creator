import { z } from 'zod';
import { HttpError } from './http';

const envelope = z.object({ code: z.number(), data: z.unknown().optional() });
export const taskId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const rigType = z.enum(['biped', 'quadruped', 'hexapod', 'octopod', 'avian', 'serpentine', 'aquatic']);
const optionalText = z.string().nullish().transform(value => value?.trim() || undefined);
export const taskSchema = z.object({
  task_id: taskId,
  status: z.enum(['queued', 'running', 'success', 'failed', 'cancelled', 'banned', 'expired', 'unknown']),
  progress: z.number().nullish().transform(value => value ?? 0),
  output: z.object({
    model_url: optionalText,
    riggable: z.boolean().nullish().transform(value => value ?? undefined),
    topology: optionalText,
    rig_type: optionalText,
  }).nullish().transform(value => value ?? undefined),
  error_message: optionalText,
  error_code: z.union([z.string(), z.number()]).nullish(),
  error_msg: optionalText,
}).transform(({ error_message, error_msg, error_code, ...task }) => ({
  ...task,
  error_message: (error_message ?? error_msg)?.slice(0, 300),
  error_code: error_code ?? undefined,
}));

export class TripoRejectedError extends HttpError {}
export class TripoTaskUnavailableError extends HttpError {
  constructor() { super(410, 'Tripo 上的原任务已失效。'); }
}

export function tripoKey() {
  const key = process.env.TRIPO_API_KEY?.trim();
  if (!key) throw new HttpError(503, '请在服务端配置 TRIPO_API_KEY');
  return key;
}

export async function tripo(path: string, signal: AbortSignal, body?: object | FormData) {
  const key = tripoKey();
  const multipart = body instanceof FormData;
  const response = await fetch(`https://openapi.tripo3d.ai${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}`, ...(!multipart && body ? { 'Content-Type': 'application/json' } : {}) },
    body: multipart ? body : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]), cache: 'no-store', redirect: 'error',
  });
  if (!response.ok) {
    if (!body && path.startsWith('/v3/tasks/') && (response.status === 404 || response.status === 410)) throw new TripoTaskUnavailableError();
    const ErrorType = [400, 401, 402, 403, 404, 410, 422, 429].includes(response.status) ? TripoRejectedError : HttpError;
    throw new ErrorType(response.status === 429 ? 429 : 502, `Tripo 请求失败（${response.status}）`);
  }
  const parsed = envelope.safeParse(await response.json());
  if (!parsed.success) throw new HttpError(502, 'Tripo 返回无效的任务响应');
  if (parsed.data.code !== 0) throw new TripoRejectedError(502, 'Tripo 拒绝了任务请求');
  return parsed.data.data;
}

export async function readTripoTask(id: string, signal: AbortSignal) {
  const task = taskSchema.parse(await tripo(`/v3/tasks/${id}`, signal));
  if (task.task_id !== id) throw new HttpError(502, 'Tripo 返回了不匹配的任务');
  return task;
}
