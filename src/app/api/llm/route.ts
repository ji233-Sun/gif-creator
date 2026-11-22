import { NextRequest } from 'next/server';
import { z } from 'zod';
import { characterImageType } from '@/lib/character-image';
import { failure, guard, HttpError, readJson } from '@/server/http';
import { validateImagePixels } from '@/server/model-image';

export const runtime = 'nodejs';
const toolName = z.literal('design_actor');
const textPart = z.object({ type: z.literal('text'), text: z.string() });
const maxImageBase64 = 5 * 1024 * 1024;
const imageUrl = z.string().max(maxImageBase64 + 32).refine(value => {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const [, type, base64] = match;
  if (base64.length % 4 !== 0 || base64.length > maxImageBase64) return false;
  const tail = base64.slice(-4);
  if (Buffer.from(tail, 'base64').toString('base64') !== tail) return false;
  return characterImageType(Buffer.from(base64.slice(0, 16), 'base64')) === type;
});
const imagePart = z.object({ type: z.literal('image_url'), image_url: z.object({
  url: imageUrl,
  detail: z.enum(['auto', 'low', 'high']).optional(),
}) });
const textContent = z.union([z.string(), z.array(textPart)]);
const message = z.discriminatedUnion('role', [
  z.object({ role: z.literal('system'), content: z.string() }),
  z.object({ role: z.literal('user'), content: z.union([z.string(), z.array(z.union([textPart, imagePart])).max(2)]) }),
  z.object({ role: z.literal('assistant'), content: textContent.nullish(), tool_calls: z.array(z.object({
    id: z.string(), type: z.literal('function'), function: z.object({ name: toolName, arguments: z.string() }),
  })).max(6).optional() }),
  z.object({ role: z.literal('tool'), tool_call_id: z.string(), content: textContent }),
]);
const requestSchema = z.object({
  messages: z.array(message).min(1).max(24),
  stream: z.boolean().optional(),
  stream_options: z.object({ include_usage: z.boolean().optional() }).optional(),
  tools: z.array(z.object({ type: z.literal('function'), function: z.object({ name: toolName, description: z.string().optional(), parameters: z.record(z.string(), z.unknown()).optional() }) })).max(3).optional(),
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
    const images = new Set<string>();
    for (const entry of parsed.data.messages) {
      if (entry.role !== 'user' || !Array.isArray(entry.content)) continue;
      for (const part of entry.content) if (part.type === 'image_url') images.add(part.image_url.url);
    }
    if (images.size > 1) throw new HttpError(400, '一次只能为一位演员定妆');
    for (const url of images) await validateImagePixels(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    const response = await fetch(deepseek ? 'https://api.deepseek.com/chat/completions' : 'https://ai-gateway.vercel.sh/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...parsed.data, model: process.env.DIRECTOR_MODEL?.trim() || (deepseek ? 'deepseek-flash' : 'anthropic/claude-sonnet-4.5'),
        max_tokens: 4096,
        ...(parsed.data.tools?.length ? { tool_choice: 'required' } : {}),
        ...(deepseek ? { thinking: { type: 'disabled' } } : { n: 1 }),
      }),
      redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
    });
    if (!response.ok) {
      const status = response.status === 429 ? 429 : response.status >= 400 && response.status < 500 ? 422 : 502;
      throw new HttpError(status, `AI 服务请求失败（${response.status}）`);
    }
    return new Response(response.body, { headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
