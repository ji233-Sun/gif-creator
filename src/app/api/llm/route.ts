import { NextRequest } from 'next/server';
import { z } from 'zod';
import { failure, guard, HttpError, readJson } from '@/server/http';

export const runtime = 'nodejs';
const requestSchema = z.object({
  messages: z.array(z.unknown()).min(1).max(200),
  stream: z.boolean().optional(),
  stream_options: z.object({ include_usage: z.boolean().optional() }).optional(),
  tools: z.array(z.object({ type: z.literal('function'), function: z.object({ name: z.string(), description: z.string().optional(), parameters: z.record(z.string(), z.unknown()).optional() }) })).max(3).optional(),
  tool_choice: z.enum(['none', 'auto', 'required']).optional(),
});

export async function POST(request: NextRequest) {
  try {
    guard(request, 30);
    const deepseek = process.env.DIRECTOR_PROVIDER === 'deepseek';
    const keyName = deepseek ? 'DEEPSEEK_API_KEY' : 'VERCEL_AI_GATEWAY_KEY';
    const key = process.env[keyName];
    if (!key) throw new HttpError(503, `请在服务端配置 ${keyName}`);
    const parsed = requestSchema.safeParse(await readJson(request, 16 * 1024 * 1024));
    if (!parsed.success) throw new HttpError(400, '模型请求格式无效');
    const response = await fetch(deepseek ? 'https://api.deepseek.com/chat/completions' : 'https://ai-gateway.vercel.sh/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...parsed.data, model: process.env.DIRECTOR_MODEL || (deepseek ? 'deepseek-flash' : 'anthropic/claude-sonnet-4.5'),
        max_tokens: 2048, ...(deepseek ? { thinking: { type: 'disabled' } } : { n: 1 }),
      }),
      redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
    });
    if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 502, `AI 服务请求失败（${response.status}）`);
    return new Response(response.body, { headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
