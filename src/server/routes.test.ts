// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { POST } from '../app/api/llm/chat/completions/route';
import { requestCustomEndpoint } from './custom-ai-endpoint';

vi.mock('./custom-ai-endpoint', () => ({ requestCustomEndpoint: vi.fn() }));

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==', 'base64');
const localImage = `data:image/png;base64,${png.toString('base64')}`;
function request(body?: unknown, headers: HeadersInit = {}) {
  return new NextRequest('http://localhost:3000/api/llm/chat/completions', {
    method: 'POST', body: JSON.stringify(body), headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'x-paji-ai-provider': 'openai-responses', 'x-paji-ai-model': 'gpt-5-mini', authorization: 'Bearer test-only', ...headers },
  });
}
function vision(url: string, name = 'design_actor') {
  return { messages: [{ role: 'system', content: 'Design an actor.' }, { role: 'user', content: [{ type: 'text', text: 'Use this image' }, { type: 'image_url', image_url: { url } }] }], tools: [{ type: 'function', function: { name, parameters: { type: 'object' } } }] };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('routes using the settings on the request and never reads the old environment configuration', async () => {
  vi.stubEnv('DIRECTOR_PROVIDER', 'deepseek');
  vi.stubEnv('DIRECTOR_MODEL', 'unused');
  const fetcher = vi.fn().mockResolvedValue(Response.json({ status: 'completed', output: [{ type: 'function_call', name: 'design_actor', call_id: 'call_1', arguments: '{}' }] }));
  vi.stubGlobal('fetch', fetcher);
  const response = await POST(request(vision(localImage)));
  expect(response.status).toBe(200);
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe('https://api.openai.com/v1/responses');
  expect(new Headers(options.headers).get('authorization')).toBe('Bearer test-only');
  expect(JSON.parse(options.body)).toMatchObject({ model: 'gpt-5-mini', store: false });
  expect(await response.text()).toContain('design_actor');
});

it.each([
  ['openai-responses', 'https://relay.example/v1/', 'gpt-6.2-sol', 'https://relay.example/v1/responses'],
  ['openai-responses', 'https://relay.example/v1/responses', 'gpt-6.2-sol', 'https://relay.example/v1/responses'],
  ['openai-chat', 'https://relay.example/openai/v1', 'gateway-model', 'https://relay.example/openai/v1/chat/completions'],
  ['anthropic', 'https://relay.example/anthropic/v1', 'gateway-model', 'https://relay.example/anthropic/v1/messages'],
  ['gemini', 'https://relay.example/v1beta', 'gemini-2.5-flash', 'https://relay.example/v1beta/models/gemini-2.5-flash:generateContent'],
])('routes a %s request to the custom endpoint', async (provider, baseUrl, model, endpoint) => {
  const call = { name: 'design_actor', arguments: '{}' };
  const bodies: Record<string, unknown> = {
    'openai-responses': { status: 'completed', output: [{ type: 'function_call', ...call }] },
    'openai-chat': { choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: call }] } }] },
    anthropic: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: call.name, input: {} }] },
    gemini: { candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: call.name, args: {} } }] } }] },
  };
  const custom = vi.mocked(requestCustomEndpoint).mockResolvedValue(Response.json(bodies[provider]));
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const response = await POST(request(vision(localImage), { 'x-paji-ai-provider': provider, 'x-paji-ai-base-url': baseUrl, 'x-paji-ai-model': model }));
  expect(response.status).toBe(200);
  expect(custom).toHaveBeenCalledOnce();
  const [url, options] = custom.mock.calls[0];
  expect(url.href).toBe(endpoint);
  expect(options.body).toContain('image/png');
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(['http://relay.example/v1', 'https://user:pass@relay.example/v1', 'https://relay.example/v1?key=test', 'https://relay.example/v1#fragment'])('rejects invalid Base URL %s', async baseUrl => {
  expect((await POST(request(vision(localImage), { 'x-paji-ai-base-url': baseUrl }))).status).toBe(400);
  expect(requestCustomEndpoint).not.toHaveBeenCalled();
});

it('does not allow a custom Base URL for ChatGPT subscriber credentials', async () => {
  expect((await POST(request(vision(localImage), { 'x-paji-ai-provider': 'chatgpt', 'x-paji-ai-base-url': 'https://relay.example/v1' }))).status).toBe(400);
  expect(requestCustomEndpoint).not.toHaveBeenCalled();
});

it('rejects untrusted images, protocols and tools before contacting a provider', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const oversized = await sharp({ create: { width: 4097, height: 4096, channels: 3, background: '#fff' } }).png().toBuffer();
  for (const body of [vision('https://example.invalid/remote.png'), vision(`data:image/png;base64,${oversized.toString('base64')}`), vision('data:image/png;base64,a'), vision(localImage, 'unrelated')])
    expect((await POST(request(body))).status).toBe(400);
  expect((await POST(request(vision(localImage), { 'x-paji-ai-provider': 'https://example.invalid' }))).status).toBe(400);
  expect((await POST(request(vision(localImage), { origin: 'https://example.invalid' }))).status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});

it('requires the matching page credential and ignores bearer headers in ChatGPT mode', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect((await POST(request(vision(localImage), { authorization: '' }))).status).toBe(401);
  expect((await POST(request(vision(localImage), { 'x-paji-ai-provider': 'chatgpt' }))).status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
});
