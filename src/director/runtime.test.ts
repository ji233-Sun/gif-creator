// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST as proxy } from '../app/api/llm/chat/completions/route';

vi.mock('libfx/browser', async importOriginal => {
  const actual = await importOriginal<typeof import('libfx/browser')>();
  return { ...actual, createFxAgent: (options: Parameters<typeof actual.createFxAgent>[0]) => actual.createFxAgent({
    ...options, wasm: readFile(new URL('../../node_modules/libfx/fx-core.wasm', import.meta.url)),
  }) };
});
import { DirectorRuntime } from './runtime';

const image = new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==', 'base64')], 'actor.png', { type: 'image/png' });
const origin = 'http://localhost:3000';
const plan = { name: '红色演员', parts: [{ shape: 'sphere', color: '#EE3344', position: [0, 1, 0], size: [1, 2, 1], joint: 'body' }] };
const makeRuntime = () => new DirectorRuntime({ provider: 'openai-responses', model: 'gpt-5-mini', key: 'test-only' });

function chatStream(args: unknown) {
  const delta = { role: 'assistant', tool_calls: [{ index: 0, id: 'actor-call', type: 'function', function: { name: 'design_actor', arguments: JSON.stringify(args) } }] };
  const chunk = (delta: unknown, finish_reason: string | null) => `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'director', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return new Response(chunk(delta, null) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}

beforeEach(() => {
  vi.stubGlobal('window', { location: { origin } });
  vi.stubGlobal('FileReader', class {
    result = ''; onload?: () => void;
    async readAsDataURL(blob: Blob) { this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`; this.onload?.(); }
  });
});
afterEach(() => vi.unstubAllGlobals());

it('runs the GPT Responses adapter and real fx WASM on an image with settings from the page', async () => {
  let calls = 0;
  const requests: unknown[] = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    if (input === `${origin}/api/llm/chat/completions`) {
      calls++;
      const body = typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as Uint8Array);
      return proxy(new NextRequest(input, { method: 'POST', body, headers: init.headers, signal: init.signal ?? undefined }));
    }
    if (input !== 'https://api.openai.com/v1/responses') throw new Error('Unexpected endpoint');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-only');
    requests.push(JSON.parse(String(init.body)));
    return Response.json({ status: 'completed', output: [{ type: 'function_call', name: 'design_actor', call_id: 'call_1', arguments: JSON.stringify(plan) }] });
  });
  expect(await makeRuntime().design(image, AbortSignal.timeout(10_000))).toEqual(plan);
  expect(calls).toBe(1);
  expect(requests).toHaveLength(1);
  expect(JSON.stringify(requests[0])).toContain('data:image/png;base64,');
  expect(requests[0]).toMatchObject({ model: 'gpt-5-mini', tools: [{ name: 'design_actor' }] });
}, 12_000);

it('passes the configured Base URL only to the same-origin director proxy', async () => {
  const fetcher = vi.fn(async (_input: string, _init: RequestInit) => { void _input; void _init; return chatStream(plan); });
  vi.stubGlobal('fetch', fetcher);
  const runtime = new DirectorRuntime({ provider: 'openai-responses', model: 'gpt-6.2-sol', key: 'test-only', baseUrl: 'https://relay.example/v1' });
  expect(await runtime.design(image, AbortSignal.timeout(10_000))).toEqual(plan);
  expect(fetcher).toHaveBeenCalledOnce();
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe(`${origin}/api/llm/chat/completions`);
  expect(new Headers(init.headers).get('x-paji-ai-base-url')).toBe('https://relay.example/v1');
});

it('rejects invalid plans and does not send a second request', async () => {
  const fetcher = vi.fn(async () => chatStream({ ...plan, code: 'untrusted field' }));
  vi.stubGlobal('fetch', fetcher);
  await expect(makeRuntime().design(image, new AbortController().signal)).rejects.toThrow('有效的 3D 角色方案');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('reports proxy errors and can retry after a cancelled or failed request', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: 'AI 设置无效' }, { status: 401 })).mockResolvedValueOnce(chatStream(plan));
  vi.stubGlobal('fetch', fetcher);
  const runtime = makeRuntime();
  await expect(runtime.design(image, new AbortController().signal)).rejects.toThrow('AI 设置无效');
  await expect(runtime.design(image, new AbortController().signal)).resolves.toEqual(plan);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
