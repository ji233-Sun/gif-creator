import { z } from 'zod';
import { HttpError } from './http';

const envelope = z.object({ code: z.number(), data: z.unknown().optional() });
export const taskId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const taskSchema = z.object({
  task_id: taskId,
  status: z.enum(['queued', 'running', 'success', 'failed', 'cancelled', 'banned', 'expired', 'unknown']),
  progress: z.number().optional().default(0),
  output: z.object({ model_url: z.string().url().optional(), riggable: z.boolean().optional(), topology: z.string().optional(), rig_type: z.string().optional() }).optional(),
  error_msg: z.string().optional(),
});
export type ModelTask = z.infer<typeof taskSchema>;

export async function tripo(path: string, signal: AbortSignal, body?: object | FormData) {
  const key = process.env.TRIPO_API_KEY;
  if (!key) throw new HttpError(503, '请在服务端配置 TRIPO_API_KEY');
  const multipart = body instanceof FormData;
  const response = await fetch(`https://openapi.tripo3d.ai${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}`, ...(!multipart && body ? { 'Content-Type': 'application/json' } : {}) },
    body: multipart ? body : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]), cache: 'no-store',
  });
  if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 502, `Tripo 请求失败（${response.status}）`);
  const parsed = envelope.safeParse(await response.json());
  if (!parsed.success || parsed.data.code !== 0) throw new HttpError(502, 'Tripo 返回无效或失败的任务响应');
  return parsed.data.data;
}

export function imageFormat(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && Buffer.from(bytes.subarray(1, 8)).equals(Buffer.from([80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (Buffer.from(bytes.subarray(0, 4)).toString() === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString() === 'WEBP') return 'image/webp';
  return null;
}
