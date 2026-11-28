// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invokeDirector } from './ai-transport';
import { HttpError } from './http';

type Options = Parameters<typeof invokeDirector>[0];
const name = 'design_actor';
const input = { name: '小演员', parts: [{ shape: 'sphere' }] };
const args = JSON.stringify(input);
const image = { url: 'data:image/png;base64,aW1hZ2U=', detail: 'high' } as const;
const parts: Options['parts'] = [{ type: 'text', text: 'Make an actor' }, { type: 'image_url', image_url: image }];
const tool = { name, description: 'Return a plan', parameters: { type: 'object' } } as const;
const system = 'Only provide the plan.';
const secret = 'mock-credential';
const fn = { name, arguments: args };
const chatCall = { id: 'upstream-chat-id', type: 'function', function: fn };
const responseCall = { id: 'upstream-response-id', type: 'function_call', status: 'completed', ...fn };
const messageCall = { id: 'upstream-message-id', type: 'tool_use', name, input };
const chatJson = { choices: [{ finish_reason: 'tool_calls', message: { content: 'Ignore this text', tool_calls: [chatCall] } }] };
const responseJson = { status: 'completed', output: [{ type: 'reasoning' }, responseCall] };
const messageJson = { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Ignore this text' }, messageCall] };

function invoke(provider: Options['provider'] = 'openai-chat', model = 'caller-model', signal = new AbortController().signal) {
  return invokeDirector({ provider, model, key: secret, system, parts, tool, signal });
}
function mock(response: Response) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
function event(payload: unknown, type?: string) {
  return `${type ? `event: ${type}\r\n` : ''}data: ${JSON.stringify(payload)}\r\n\r\n`;
}
const done = 'data: [DONE]\n\n';
const eventHeaders = { 'Content-Type': 'text/event-stream; charset=utf-8' };
function sse(...frames: string[]) {
  const bytes = new TextEncoder().encode(frames.join(''));
  let pos = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pos >= bytes.length) controller.close();
      else controller.enqueue(bytes.subarray(pos, ++pos));
    },
  }), { headers: eventHeaders });
}
const chatDelta = (func: Record<string, string>, index = 0) => event({
  choices: [{ index: 0, delta: { tool_calls: [{ index, function: func }] }, finish_reason: null }],
});
const chatStop = (reason = 'tool_calls') => event({ choices: [{ index: 0, delta: {}, finish_reason: reason }] });
const messageStart = event({ index: 1, content_block: { ...messageCall, input: {} } }, 'content_block_start');
const messageDelta = (partial_json: string) => event({ index: 1, delta: { type: 'input_json_delta', partial_json } }, 'content_block_delta');
const messageClose = event({ index: 1 }, 'content_block_stop');
const messageFinish = (stop_reason = 'tool_use') => event({ delta: { stop_reason } }, 'message_delta');
const responseStart = event({ type: 'response.output_item.added', output_index: 1, item: { ...responseCall, status: 'in_progress', arguments: '' } });
const responseDelta = (delta: string, item_id = responseCall.id) => event({ type: 'response.function_call_arguments.delta', item_id, output_index: 1, delta });
const responseDone = (response: unknown = { status: 'completed' }) => event({ response }, 'response.completed');

async function expectPlan(response: Response, model = 'caller-model') {
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toContain('text/event-stream');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const output = await response.text();
  expect(output).not.toMatch(/Ignore this text|upstream-.*-id|mock-credential/);
  const [first, last, terminal, ...extra] = output.trim().split('\n\n');
  expect(extra).toEqual([]);
  expect(terminal).toBe('data: [DONE]');
  expect(JSON.parse(first.slice(6))).toMatchObject({ model, object: 'chat.completion.chunk', choices: [{ index: 0,
    delta: { role: 'assistant', tool_calls: [{ index: 0, id: expect.any(String), type: 'function', function: fn }] }, finish_reason: null,
  }] });
  expect(JSON.parse(last.slice(6)).choices).toEqual([{ index: 0, delta: {}, finish_reason: 'tool_calls' }]);
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('director upstream requests', () => {
  it('sends Gemini inline images and normalizes native function calls', async () => {
    const fetcher = mock(Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name, args: input } }] } }] }));
    await expectPlan(await invoke('gemini', 'gemini-2.5-flash'), 'gemini-2.5-flash');
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe(secret);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      contents: [{ role: 'user', parts: [{ text: 'Make an actor' }, { inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] }],
      tools: [{ functionDeclarations: [{ name, parametersJsonSchema: { type: 'object' } }] }],
    });
  });

  it('rejects truncated Gemini results instead of triggering the local tool', async () => {
    mock(Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ functionCall: { name, args: input } }] } }] }));
    await expect(invoke('gemini', 'gemini-2.5-flash')).rejects.toMatchObject({ status: 502 });
  });
  it.each<{
    provider: Options['provider']; url: string; model: string; protocol: 'chat' | 'messages' | 'responses';
  }>([
    { provider: 'openai-chat', url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-5-mini', protocol: 'chat' },
    { provider: 'openai-responses', url: 'https://api.openai.com/v1/responses', model: 'gpt-5.1', protocol: 'responses' },
    { provider: 'chatgpt', url: 'https://api.openai.com/v1/responses', model: 'gpt-5', protocol: 'responses' },
    { provider: 'anthropic', url: 'https://api.anthropic.com/v1/messages', model: 'claude-test', protocol: 'messages' },
    { provider: 'deepseek', url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', protocol: 'chat' },
    { provider: 'gateway', url: 'https://ai-gateway.vercel.sh/v1/chat/completions', model: 'openai/gpt-5', protocol: 'chat' },
  ])('pins $provider route, auth, tool, and image format', async ({ provider, url, model, protocol }) => {
    const fetcher = mock(Response.json(protocol === 'responses' ? responseJson : protocol === 'messages' ? messageJson : chatJson));
    await expectPlan(await invoke(provider, model), model);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'POST', redirect: 'error', signal: expect.any(AbortSignal) }));
    const init = fetcher.mock.calls[0][1]!;
    expect(init.headers).toEqual(protocol === 'messages'
      ? { 'Content-Type': 'application/json', 'x-api-key': secret, 'anthropic-version': '2023-06-01' }
      : { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` });
    const body = JSON.parse(String(init.body));
    const common = { model, stream: true };
    if (protocol === 'responses') {
      expect(body).toEqual({ ...common, store: false, max_output_tokens: 6144, parallel_tool_calls: false, instructions: system,
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Make an actor' }, { type: 'input_image', image_url: image.url, detail: 'high' }] }],
        tools: [{ type: 'function', ...tool, strict: false }], tool_choice: { type: 'function', name },
      });
    } else if (protocol === 'messages') {
      expect(body).toEqual({ ...common, system, max_tokens: 6144,
        messages: [{ role: 'user', content: [parts[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } }] }],
        tools: [{ name, description: tool.description, input_schema: tool.parameters }],
        tool_choice: { type: 'tool', name, disable_parallel_tool_use: true },
      });
    } else {
      expect(body).toEqual({ ...common,
        messages: [{ role: 'system', content: system }, { role: 'user', content: parts }],
        tools: [{ type: 'function', function: tool }], tool_choice: { type: 'function', function: { name } },
        ...(provider === 'openai-chat' ? { max_completion_tokens: 6144, parallel_tool_calls: false } : { max_tokens: 6144 }),
        ...(provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
      });
    }
  });
});

describe('director upstream SSE', () => {
  it('joins split Chat fields through one-byte chunks, comments, multi-line frames and usage', async () => {
    mock(sse(': keepalive\r\n\r\n', 'data: {\r\ndata: "choices": []}\r\n\r\n',
      chatDelta({ name: 'design_' }), chatDelta({ name: 'actor', arguments: args.slice(0, 12) }),
      chatDelta({ arguments: args.slice(12) }), chatStop(), event({ choices: [], usage: { total_tokens: 2 } }), done));
    await expectPlan(await invoke());
  });

  it('joins Messages input deltas at the tool block index, ignoring pings and text blocks', async () => {
    mock(sse(event({ type: 'ping' }, 'ping'), event({ index: 0, content_block: { type: 'text', text: 'Ignore this text' } }, 'content_block_start'),
      messageStart, messageDelta(args.slice(0, 8)), messageDelta(args.slice(8)), messageClose, messageFinish(), event({}, 'message_stop')));
    await expectPlan(await invoke('anthropic'));
  });

  it('joins Responses arguments when the completion event contains no final output array', async () => {
    mock(sse(responseStart, responseDelta(args.slice(0, 10)), responseDelta(args.slice(10)), responseDone()));
    await expectPlan(await invoke('openai-responses'));
  });

  it('accepts the official plan stream even if its Content-Type is absent', async () => {
    const bytes = new TextEncoder().encode(responseStart + responseDelta(args) + responseDone(responseJson));
    mock(new Response(bytes));
    await expectPlan(await invoke('chatgpt'));
  });

  it('uses a final Responses snapshot once rather than appending duplicate arguments', async () => {
    mock(sse(responseStart, responseDelta(args), event({ type: 'response.function_call_arguments.done', output_index: 1, arguments: args }),
      event({ type: 'response.output_item.done', output_index: 1, item: responseCall }), responseDone(responseJson)));
    await expectPlan(await invoke('chatgpt'));
  });

  it('finishes a gateway stream at [DONE] without waiting for the upstream connection to close', async () => {
    const cancel = vi.fn();
    const data = new TextEncoder().encode(chatDelta(fn) + done);
    mock(new Response(new ReadableStream({ start: controller => controller.enqueue(data), cancel }), { headers: eventHeaders }));
    await expectPlan(await invoke('gateway'));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each<[string, Options['provider'], string[]]>([
    ['Chat EOF before a terminal', 'openai-chat', [chatDelta(fn)]],
    ['Chat length even with valid JSON', 'deepseek', [chatDelta(fn), chatStop('length'), done]],
    ['Chat terminal with invalid arguments', 'gateway', [chatDelta({ ...fn, arguments: '{' }), chatStop(), done]],
    ['Chat malformed JSON frame', 'openai-chat', [chatDelta(fn), 'data: {\n\n', chatStop(), done]],
    ['Chat wrong tool name', 'openai-chat', [chatDelta({ ...fn, name: 'other_tool' }), chatStop(), done]],
    ['Chat second tool index', 'openai-chat', [chatDelta(fn), chatDelta(fn, 1), chatStop(), done]],
    ['Chat incomplete terminal frame', 'openai-chat', [chatDelta(fn), 'data: [DONE]']],
    ['Messages EOF without message_stop', 'anthropic', [messageStart, messageDelta(args), messageClose, messageFinish()]],
    ['Messages token limit', 'anthropic', [messageStart, messageDelta(args), messageClose, messageFinish('max_tokens'), event({}, 'message_stop')]],
    ['Messages missing content_block_stop', 'anthropic', [messageStart, messageDelta(args), messageFinish(), event({}, 'message_stop')]],
    ['Responses EOF after valid arguments', 'openai-responses', [responseStart, responseDelta(args)]],
    ['Responses explicit incomplete status', 'chatgpt', [responseStart, responseDelta(args), event({ type: 'response.incomplete' })]],
    ['Responses terminal snapshot missing the call', 'openai-responses', [responseStart, responseDelta(args), responseDone({ status: 'completed', output: [] })]],
    ['Responses interleaved calls', 'openai-responses', [responseStart, responseDelta(args, 'other-item'), responseDone()]],
  ])('rejects %s', async (_label, provider, frames) => {
    mock(sse(...frames));
    await expect(invoke(provider)).rejects.toMatchObject({ status: 502 });
  });
});

describe('director failures and limits', () => {
  it.each([{}, { ...responseJson, status: 'incomplete' }, { ...responseJson, output: [responseCall, responseCall] },
    { ...responseJson, output: [{ ...responseCall, arguments: '[]' }] },
  ])('rejects a malformed or incomplete nonstream result', async json => {
    mock(Response.json(json));
    await expect(invoke('openai-responses')).rejects.toBeInstanceOf(HttpError);
  });

  it.each([[401, 401], [403, 401], [400, 422], [429, 429], [500, 502], [307, 502]])('sanitizes HTTP status %i', async (status, expected) => {
    mock(new Response(`Sensitive upstream body: ${secret}`, { status }));
    const result = invoke();
    await expect(result).rejects.toMatchObject({ status: expected });
    await expect(result).rejects.not.toThrow(/Sensitive upstream body|mock-credential/);
  });

  it('sanitizes SSE errors even after a parseable tool call and Chat finish reason', async () => {
    mock(sse(chatDelta(fn), chatStop(), event({ error: { type: 'rate_limit_error', message: secret } }, 'error'), done));
    const result = invoke();
    await expect(result).rejects.toMatchObject({ status: 429 });
    await expect(result).rejects.not.toThrow(secret);
  });

  it('cancels an oversized body without returning a partial result', async () => {
    const cancel = vi.fn();
    mock(new Response(new ReadableStream({ start: controller => controller.enqueue(new Uint8Array(1024 * 1024 + 1)), cancel })));
    await expect(invoke()).rejects.toMatchObject({ status: 502 });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(['abort', 'timeout'] as const)('cancels a stalled response on %s', async mode => {
    vi.useFakeTimers();
    const cancel = vi.fn(), pull = vi.fn();
    const fetcher = mock(new Response(new ReadableStream({ pull, cancel }), { headers: eventHeaders }));
    const controller = new AbortController();
    const result = invoke('openai-chat', 'caller-model', controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ status: 502, message: expect.stringContaining(mode === 'abort' ? '取消' : '超时') });
    await vi.advanceTimersByTimeAsync(0);
    expect(pull).toHaveBeenCalled();
    if (mode === 'abort') controller.abort(new Error(secret));
    else await vi.advanceTimersByTimeAsync(120_000);
    await rejected;
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not fetch when the caller signal is already aborted', async () => {
    const fetcher = mock(Response.json(chatJson));
    await expect(invoke('openai-chat', 'caller-model', AbortSignal.abort(secret))).rejects.toMatchObject({ status: 502 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
