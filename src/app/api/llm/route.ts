import { NextRequest } from 'next/server';
import { z } from 'zod';
import { characterImageType } from '@/lib/character-image';
import { failure, guard, HttpError, readJson } from '@/server/http';
import { validateImagePixels } from '@/server/model-image';
import { baseUrlSchema, directorBaseUrlHeader, directorModelHeader, directorProviderHeader, keySchema, modelSchema, providerSchema } from '@/director/settings';
import { invokeDirector } from '@/server/ai-transport';
import { performanceInstructions } from '@/director/performance';
import { portraitPromptLimit, portraitScoreToolSchema, portraitToolName } from '@/score/portrait';
import { chatGptAccessToken } from '@/server/chatgpt-session';

export const runtime = 'nodejs';
const toolName = z.enum(['design_actor', portraitToolName]);
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
const requestSchema = z.object({
  messages: z.tuple([
    z.object({ role: z.literal('system'), content: z.string().min(1).max(16_384) }),
    z.object({ role: z.literal('user'), content: z.array(z.union([textPart, imagePart])).length(2) }),
  ]),
  tools: z.tuple([z.object({ type: z.literal('function'), function: z.object({
    name: toolName, description: z.string().max(1024).optional(), parameters: z.record(z.string(), z.unknown()).optional(),
  }) })]),
});

export async function POST(request: NextRequest) {
  try {
    guard(request, 30);
    const provider = providerSchema.safeParse(request.headers.get(directorProviderHeader));
    const model = modelSchema.safeParse(request.headers.get(directorModelHeader));
    if (!provider.success || !model.success) throw new HttpError(400, '请在网页的 AI 设置中选择服务和模型。');
    const baseUrlHeader = request.headers.get(directorBaseUrlHeader);
    if (provider.data === 'chatgpt' && baseUrlHeader !== null) throw new HttpError(400, 'ChatGPT 订阅只能使用官方接口。');
    const baseUrl = baseUrlHeader === null ? undefined : baseUrlSchema.safeParse(baseUrlHeader);
    if (baseUrl && !baseUrl.success) throw new HttpError(400, 'Base URL 必须是有效的 HTTPS 地址，不能包含账号、查询参数或片段。');
    const bearer = keySchema.safeParse(request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]);
    const key = provider.data === 'chatgpt'
      ? chatGptAccessToken(request)
      : bearer.success ? bearer.data : undefined;
    if (!key) throw new HttpError(401, '请在网页的 AI 设置中填写该服务的 API Key。');
    const parsed = requestSchema.safeParse(await readJson(request, 6 * 1024 * 1024));
    if (!parsed.success) throw new HttpError(400, '模型请求格式无效。');
    const [system, user] = parsed.data.messages;
    const image = user.content.find(part => part.type === 'image_url');
    const text = user.content.find(part => part.type === 'text');
    if (!image || !text) throw new HttpError(400, '导演需要一张角色图和提示文字。');
    const tool = parsed.data.tools[0].function;
    const performance = tool.name === portraitToolName;
    if (performance && (!text.text.trim() || text.text.trim().length > portraitPromptLimit)) {
      throw new HttpError(400, '请输入 1–600 字的开拍指令。');
    }
    const url = image.image_url.url;
    await validateImagePixels(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    return await invokeDirector({ provider: provider.data, model: model.data, baseUrl: baseUrl?.data, key, system: performance ? performanceInstructions : system.content,
      parts: user.content, tool: performance ? { name: portraitToolName, description: '提交 GIF 动作谱', parameters: portraitScoreToolSchema } : tool, signal: request.signal });
  } catch (error) { return failure(error); }
}
