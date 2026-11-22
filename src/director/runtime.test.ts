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

const realFetch = globalThis.fetch;
const image = new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==', 'base64')], 'actor.png', { type: 'image/png' });
const origin = 'http://localhost:3000';
const plan = { name: '红色演员', parts: [{ shape: 'sphere', color: '#EE3344', position: [0, 1, 0], size: [1, 2, 1], joint: 'body' }] };

function stream(args: unknown) {
  const delta = { role: 'assistant', tool_calls: [{ index: 0, id: 'actor-call', type: 'function', function: { name: 'design_actor', arguments: JSON.stringify(args) } }] };
  const chunk = (delta: unknown, finish_reason: string | null) => `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'director', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return new Response(': keep-alive\n\n' + chunk(delta, null) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}

beforeEach(() => {
  vi.stubGlobal('window', { location: { origin } });
  vi.stubGlobal('FileReader', class {
    result = ''; onload?: () => void;
    async readAsDataURL(blob: Blob) { this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`; this.onload?.(); }
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const backends = process.env.PAJI_LIVE_DEEPSEEK === '1' ? ['fixture', 'deepseek'] : ['fixture'];
it.each(backends)('produces a valid plan from vision input in one real fx WASM turn with %s', async backend => {
  vi.stubEnv('DIRECTOR_PROVIDER', backend === 'fixture' ? 'gateway' : 'deepseek');
  vi.stubEnv('VERCEL_AI_GATEWAY_KEY', 'fixture-key');
  let calls = 0;
  const requests: unknown[] = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    if (input === `${origin}/api/llm/chat/completions`) {
      calls++;
      const body = typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as Uint8Array);
      return proxy(new NextRequest(input, { method: 'POST', body, signal: init.signal ?? undefined }));
    }
    requests.push(JSON.parse(String(init.body)));
    if (backend === 'deepseek' && input === 'https://api.deepseek.com/chat/completions') return realFetch(input, init);
    if (input === 'https://ai-gateway.vercel.sh/v1/chat/completions') return stream(plan);
    throw new Error('Unexpected endpoint');
  });
  const design = await new DirectorRuntime().design(image, AbortSignal.timeout(45_000));
  expect(design.parts.length).toBeGreaterThan(0);
  if (backend === 'fixture') expect(design).toEqual(plan);
  expect(calls).toBe(1);
  expect(requests).toHaveLength(1);
  expect(JSON.stringify(requests[0])).toContain('data:image/png;base64,');
  expect(requests[0]).toMatchObject({ tool_choice: 'required', tools: [{ function: { name: 'design_actor' } }] });
}, 50_000);

it('rejects plans with unrelated fields without a second AI request', async () => {
  const fetcher = vi.fn(async () => stream({ ...plan, code: 'untrusted field' }));
  vi.stubGlobal('fetch', fetcher);
  await expect(new DirectorRuntime().design(image, new AbortController().signal)).rejects.toThrow('有效的 3D 角色方案');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('shows the proxy error and supports a later retry', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: '请配置 DEEPSEEK_API_KEY' }, { status: 503 })).mockResolvedValueOnce(stream(plan));
  vi.stubGlobal('fetch', fetcher);
  const runtime = new DirectorRuntime();
  await expect(runtime.design(image, new AbortController().signal)).rejects.toThrow('DEEPSEEK_API_KEY');
  await expect(runtime.design(image, new AbortController().signal)).resolves.toEqual(plan);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('does not build on a cancelled AI request', async () => {
  const controller = new AbortController();
  const fetcher = vi.fn(async () => { controller.abort(); return stream(plan); });
  vi.stubGlobal('fetch', fetcher);
  await expect(new DirectorRuntime().design(image, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
