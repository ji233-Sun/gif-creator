import { NextRequest, NextResponse } from 'next/server';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const windows = new Map<string, { count: number; reset: number }>();

export function guard(request: NextRequest, limit = 60) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host') ?? request.nextUrl.host;
  const expectedOrigin = `${request.nextUrl.protocol}//${host}`;
  if (origin && origin !== expectedOrigin) throw new HttpError(403, '请求来源不受信任');
  const now = Date.now();
  for (const [key, value] of windows) if (value.reset < now) windows.delete(key);
  const key = `${request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'}:${request.method}:${request.nextUrl.pathname}`;
  const entry = windows.get(key) ?? { count: 0, reset: now + 60_000 };
  if (++entry.count > limit) throw new HttpError(429, '请求过于频繁，请稍后再试');
  windows.set(key, entry);
}

export async function readJson(request: Request, maxBytes = 2_000_000): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '请求体为空');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new HttpError(413, '请求体过大'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new HttpError(400, 'JSON 格式无效'); }
}

export function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof HttpError ? error.message : '服务请求失败，请稍后重试' }, {
    status: error instanceof HttpError ? error.status : 502,
  });
}
