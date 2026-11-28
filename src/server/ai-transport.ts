import { baseUrlSchema, providers, type DirectorProtocol, type DirectorProvider } from '@/director/settings';
import { actorPlanTokenBudget } from '@/model/actor-plan';
import { portraitTokenBudget, portraitToolName } from '@/score/portrait';
import { requestCustomEndpoint } from './custom-ai-endpoint';
import { HttpError } from './http';
type ToolName = 'design_actor' | typeof portraitToolName;
type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };
type Options = {
  provider: DirectorProvider; model: string; baseUrl?: string; key: string; system: string; parts: Part[];
  tool: { name: ToolName; description?: string; parameters?: Record<string, unknown> };
  signal: AbortSignal;
};
type Protocol = DirectorProtocol;

function endpoint(options: Options, protocol: Protocol): URL {
  if (options.provider === 'chatgpt' && options.baseUrl !== undefined) throw new HttpError(400, 'ChatGPT 订阅只能使用官方接口。');
  const base = baseUrlSchema.safeParse(options.baseUrl ?? providers[options.provider].baseUrl);
  if (!base.success) throw new HttpError(400, 'Base URL 必须是有效的 HTTPS 地址。');
  const url = new URL(base.data);
  const path = url.pathname.replace(/\/+$/, '');
  const suffix = protocol === 'gemini' ? `/models/${encodeURIComponent(options.model)}:generateContent`
    : protocol === 'chat' ? '/chat/completions' : `/${protocol}`;
  if (!path.endsWith(suffix)) url.pathname = `${path}${suffix}`;
  return url;
}

function request(options: Options, protocol: Protocol) {
  const { provider, model, key, system, parts, tool: { name, description, parameters = { type: 'object' } } } = options;
  const tokenBudget = name === portraitToolName ? portraitTokenBudget : actorPlanTokenBudget;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const common = { model, stream: true };
  if (protocol === 'gemini') {
    headers['x-goog-api-key'] = key;
    const content = parts.map(part => {
      if (part.type === 'text') return { text: part.text };
      const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(part.image_url.url);
      if (!match) throw upstreamError(422);
      return { inlineData: { mimeType: match[1], data: match[2] } };
    });
    return { headers, body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: content }],
      tools: [{ functionDeclarations: [{ name, description, parametersJsonSchema: parameters }] }],
      toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [name] } },
      generationConfig: { maxOutputTokens: tokenBudget },
    } };
  }
  if (protocol === 'messages') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    const content = parts.map(part => {
      if (part.type === 'text') return part;
      const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/.exec(part.image_url.url);
      if (!match) throw upstreamError(422);
      return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
    });
    return { headers, body: { ...common, system, max_tokens: tokenBudget, messages: [{ role: 'user', content }],
      tools: [{ name, description, input_schema: parameters }],
      tool_choice: { type: 'tool', name, disable_parallel_tool_use: true } } };
  }
  headers.Authorization = `Bearer ${key}`;
  if (protocol === 'responses') {
    const content = parts.map(part => part.type === 'text' ? { type: 'input_text', text: part.text }
      : { type: 'input_image', image_url: part.image_url.url, detail: part.image_url.detail ?? 'auto' });
    return { headers, body: { ...common, instructions: system, input: [{ role: 'user', content }], store: false,
      max_output_tokens: tokenBudget, parallel_tool_calls: false,
      tools: [{ type: 'function', name, description, parameters, strict: false }], tool_choice: { type: 'function', name } } };
  }
  return { headers, body: { ...common,
    messages: [{ role: 'system', content: system }, { role: 'user', content: parts }],
    tools: [{ type: 'function', function: { name, description, parameters } }],
    tool_choice: { type: 'function', function: { name } },
    ...(provider === 'openai-chat' ? { max_completion_tokens: tokenBudget, parallel_tool_calls: false } : { max_tokens: tokenBudget }),
    ...(provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
  } };
}

function upstreamError(status = 502) {
  if (status === 401 || status === 403) return new HttpError(401, 'AI 服务凭证无效或权限不足');
  if (status === 429) return new HttpError(429, 'AI 服务请求过于频繁，请稍后重试');
  if (status >= 400 && status < 500) return new HttpError(422, 'AI 服务无法处理此请求');
  return new HttpError(502, 'AI 服务未返回完整的角色方案，请重试');
}
type Fields = Record<string, unknown>;
const isObject = (value: unknown): value is Fields => !!value && typeof value === 'object' && !Array.isArray(value);
const object = (value: unknown): Fields => isObject(value) ? value : {};
const rows = (value: unknown): Fields[] => Array.isArray(value) ? value.map(object) : [];
function text(value: unknown) {
  if (typeof value === 'string' || value == null) return value ?? '';
  throw upstreamError();
}
function reportedError(payload: Fields) {
  const error = object(payload.error ?? object(payload.response).error);
  for (const code of [payload.status, error.status, error.code, error.type, payload.code]) {
    if (typeof code === 'number' && code >= 400) return upstreamError(code);
    if (code === 'rate_limit_error' || code === 'rate_limit_exceeded') return upstreamError(429);
    if (['authentication_error', 'invalid_api_key', 'permission_error'].some(value => value === code)) return upstreamError(401);
    if (code === 'invalid_request_error' || code === 'invalid_request') return upstreamError(422);
  }
  return upstreamError();
}

async function* bodyText(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) throw upstreamError();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, chunks = 0;
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1024 * 1024 || ++chunks > 65_536) throw upstreamError();
      yield decoder.decode(value, { stream: true });
    }
    yield decoder.decode();
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

async function* frames(body: AsyncIterable<string>) {
  let pending = '', cr = false, scan = 0;
  for await (const chunk of body) {
    if (!chunk) continue;
    pending += (cr && chunk.startsWith('\n') ? chunk.slice(1) : chunk).replace(/\r\n?/g, '\n');
    cr = chunk.endsWith('\r');
    let end: number;
    while ((end = pending.indexOf('\n\n', scan)) !== -1) {
      const lines = pending.slice(0, end).split('\n');
      pending = pending.slice(end + 2);
      scan = 0;
      const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
      const data = lines.filter(line => line.startsWith('data:') || line === 'data')
        .map(line => line.slice(5).replace(/^ /, '')).join('\n');
      if (event !== 'ping' && (data.trim() || event === 'error')) yield { event, data: data.trim() };
    }
    scan = Math.max(0, pending.length - 1);
  }
  if (pending.split('\n').some(line => line.trim() && !line.startsWith(':'))) throw upstreamError();
}
function completeArgs(name: ToolName, callName: unknown, args: unknown, objectInput = false) {
  const parsed: unknown = objectInput ? args : JSON.parse(text(args));
  if (callName !== name || !isObject(parsed)) throw upstreamError();
  return objectInput ? JSON.stringify(parsed) : text(args);
}
const chatFinished = (reason: unknown) => reason === 'tool_calls' || reason === 'stop';
function completePayload(name: ToolName, protocol: Protocol, payload: Fields, completedEvent = false): string {
  if (payload.error != null) throw reportedError(payload);
  if (protocol === 'gemini') {
    const [candidate] = rows(payload.candidates);
    const [call, ...extra] = rows(object(candidate?.content).parts)
      .filter(part => isObject(part.functionCall)).map(part => object(part.functionCall));
    if (candidate?.finishReason !== 'STOP' || !call || extra.length) throw upstreamError();
    return completeArgs(name, call.name, call.args, true);
  }
  if (protocol === 'chat') {
    const [choice] = rows(payload.choices);
    const [call, ...extra] = rows(object(choice?.message).tool_calls);
    if (!chatFinished(choice?.finish_reason) || call?.type !== 'function' || extra.length) throw upstreamError();
    const fn = object(call.function);
    return completeArgs(name, fn.name, fn.arguments);
  }
  const messages = protocol === 'messages';
  if (messages ? payload.stop_reason !== 'tool_use' : payload.status !== 'completed' && !(completedEvent && payload.status == null)) throw upstreamError();
  const [call, ...extra] = rows(messages ? payload.content : payload.output).filter(item => item.type === (messages ? 'tool_use' : 'function_call'));
  if (!call || extra.length || (!messages && call.status != null && call.status !== 'completed')) throw upstreamError();
  return completeArgs(name, call.name, messages ? call.input : call.arguments, messages);
}

async function streamArgs(name: ToolName, protocol: Exclude<Protocol, 'gemini'>, body: AsyncIterable<string>) {
  let fnName = '', fragments = '', full: unknown, blockIndex: unknown, itemId: unknown;
  let stopped = false, blockClosed = false;
  const fromFragments = () => completeArgs(name, fnName, full ?? fragments);
  for await (const { event, data } of frames(body)) {
    if (protocol === 'chat' && data === '[DONE]' && event !== 'error') return fromFragments();
    const payload: unknown = data ? JSON.parse(data) : {};
    if (!isObject(payload)) throw upstreamError();
    const type = payload.type ?? event;
    if (event === 'error' || type === 'error' || type === 'response.failed' || payload.error != null) throw reportedError(payload);
    if (protocol === 'chat') {
      for (const choice of rows(payload.choices).filter(choice => (choice.index ?? 0) === 0)) {
        for (const call of rows(object(choice.delta).tool_calls)) {
          if (stopped || (call.index ?? 0) !== 0 || (call.type != null && call.type !== 'function')) throw upstreamError();
          const fn = object(call.function);
          fnName += text(fn.name);
          fragments += text(fn.arguments);
        }
        if (choice.finish_reason == null) continue;
        if (!chatFinished(choice.finish_reason)) throw upstreamError();
        stopped = true;
      }
    } else if (protocol === 'messages') {
      const block = object(payload.content_block), delta = object(payload.delta);
      if (type === 'content_block_start' && block.type === 'tool_use') {
        if (blockIndex !== undefined || typeof payload.index !== 'number') throw upstreamError();
        blockIndex = payload.index;
        fnName = text(block.name);
        full = block.input;
      } else if (type === 'content_block_delta' && delta.type === 'input_json_delta') {
        if (blockIndex === undefined || blockIndex !== payload.index || blockClosed) throw upstreamError();
        fragments += text(delta.partial_json);
      } else if (type === 'content_block_stop' && blockIndex !== undefined && blockIndex === payload.index) blockClosed = true;
      else if (type === 'message_delta' && delta.stop_reason != null) {
        if (delta.stop_reason !== 'tool_use') throw upstreamError();
        stopped = true;
      } else if (type === 'message_stop') {
        if (!stopped || !blockClosed) throw upstreamError();
        return fragments ? completeArgs(name, fnName, fragments) : completeArgs(name, fnName, full, true);
      }
    } else {
      if (type === 'response.incomplete' || type === 'response.cancelled') throw upstreamError();
      const response = object(payload.response), item = object(payload.item);
      if (type === 'response.completed') {
        if (response.output !== undefined) return completePayload(name, protocol, response, true);
        if (response.status != null && response.status !== 'completed') throw upstreamError();
        return fromFragments();
      }
      const argumentEvent = type === 'response.function_call_arguments.delta' || type === 'response.function_call_arguments.done';
      if (!argumentEvent && !((type === 'response.output_item.added' || type === 'response.output_item.done') && item.type === 'function_call')) continue;
      const id = item.id ?? payload.item_id;
      if ((itemId != null && id != null && itemId !== id) || (blockIndex != null && payload.output_index != null && blockIndex !== payload.output_index)) throw upstreamError();
      itemId ??= id;
      blockIndex ??= payload.output_index;
      fnName = text(item.name ?? payload.name) || fnName;
      if (type === 'response.function_call_arguments.delta') fragments += text(payload.delta);
      else if (type === 'response.output_item.added') fragments = text(item.arguments) || fragments;
      else {
        if (item.status != null && item.status !== 'completed') throw upstreamError();
        full = item.arguments ?? payload.arguments ?? full;
      }
    }
  }
  if (protocol === 'chat' && stopped) return fromFragments();
  throw upstreamError();
}

export async function invokeDirector(options: Options): Promise<Response> {
  const { protocol } = providers[options.provider];
  const { name } = options.tool;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 120_000);
  const signal = AbortSignal.any([options.signal, timeout.signal]);
  try {
    signal.throwIfAborted();
    const { headers, body } = request(options, protocol);
    if (protocol === 'gemini' && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(options.model)) throw new HttpError(400, '请输入 Gemini 模型 ID，不含 models/ 前缀。');
    const url = endpoint(options, protocol);
    const payload = JSON.stringify(body);
    const response = options.baseUrl !== undefined
      ? await requestCustomEndpoint(url, { headers, body: payload, signal })
      : await fetch(url.href, { method: 'POST', headers, body: payload, redirect: 'error', signal });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw upstreamError(response.status);
    }
    const input = bodyText(response, signal);
    let args: string;
    try {
      let prefix = '';
      for (;;) {
        const chunk = await input.next();
        if (chunk.done) break;
        prefix += chunk.value;
        if (prefix.trimStart()) break;
      }
      async function* replay() { yield prefix; yield* input; }
      const mime = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
      if (protocol !== 'gemini' && (mime === 'text/event-stream' || (!mime && !prefix.trimStart().startsWith('{')))) {
        args = await streamArgs(name, protocol, replay());
      } else {
        let json = prefix;
        for await (const chunk of input) json += chunk;
        args = completePayload(name, protocol, object(JSON.parse(json)));
      }
    } finally { await input.return(undefined); }
    signal.throwIfAborted();
    const chunk = { id: 'chatcmpl-director', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: options.model };
    const delta = { role: 'assistant', tool_calls: [{ index: 0, id: `call_${name}`, type: 'function', function: { name, arguments: args } }] };
    const frame = (delta: object, reason: string | null) => `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`;
    return new Response(frame(delta, null) + frame({}, 'tool_calls') + 'data: [DONE]\n\n', {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (signal.aborted) throw new HttpError(502, options.signal.aborted ? 'AI 服务请求已取消' : 'AI 服务请求超时，请重试');
    throw error instanceof HttpError ? error : upstreamError();
  } finally {
    clearTimeout(timer);
    timeout.abort();
  }
}
