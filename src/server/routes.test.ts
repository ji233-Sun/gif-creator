// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { POST } from '../app/api/llm/chat/completions/route';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==', 'base64');
let sequence = 0;
function request(body?: unknown) {
  return new NextRequest('http://localhost:3000/api/llm/chat/completions', {
    method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': `test-${++sequence}` },
  });
}
function vision(url: string) { return { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }] }; }
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('director proxy', () => {
  it('pins server model and limits and streams only from the selected provider', async () => {
    vi.stubEnv('DIRECTOR_PROVIDER', 'gateway');
    vi.stubEnv('VERCEL_AI_GATEWAY_KEY', 'fixture');
    vi.stubEnv('DIRECTOR_MODEL', 'configured-model');
    const fetcher = vi.fn().mockResolvedValue(new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetcher);
    const response = await POST(request({ messages: [{ role: 'user', content: 'go' }], model: 'untrusted', stream: true, max_tokens: 999999 }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('[DONE]');
    expect(fetcher.mock.calls[0][0]).toBe('https://ai-gateway.vercel.sh/v1/chat/completions');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ model: 'configured-model', max_tokens: 4096 });
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer fixture');
  });
  it('uses the official DeepSeek vision model with the local design tool and non-thinking mode', async () => {
    vi.stubEnv('DIRECTOR_PROVIDER', 'deepseek');
    vi.stubEnv('DEEPSEEK_API_KEY', 'fixture');
    vi.stubEnv('DIRECTOR_MODEL', '');
    const fetcher = vi.fn().mockResolvedValue(new Response('data: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetcher);
    const { messages } = vision(`data:image/png;base64,${png.toString('base64')}`);
    const tools = [{ type: 'function', function: { name: 'design_actor', parameters: { type: 'object' } } }];
    const response = await POST(request({ messages, tools, stream: true, tool_choice: 'none', model: 'untrusted', thinking: { type: 'enabled' } }));
    expect(response.status).toBe(200);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer fixture');
    expect(JSON.parse(options.body)).toEqual({ messages, tools, stream: true, tool_choice: 'required', model: 'deepseek-flash', max_tokens: 4096, thinking: { type: 'disabled' } });
  });
  it('rejects remote, malformed or oversized images and unrelated tools before contacting the provider', async () => {
    vi.stubEnv('DIRECTOR_PROVIDER', 'gateway');
    vi.stubEnv('VERCEL_AI_GATEWAY_KEY', 'fixture');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const oversized = await sharp({ create: { width: 4097, height: 4096, channels: 3, background: '#fff' } }).png().toBuffer();
    for (const body of [
      vision('https://example.invalid/not-a-local-image'),
      vision(`data:image/png;base64,${png.subarray(0, 8).toString('base64')}`),
      vision(`data:image/png;base64,${oversized.toString('base64')}`),
      vision('data:image/png;base64,a'),
      vision('data:image/png;base64,YQ=='),
      vision(`data:image/jpeg;base64,${png.toString('base64')}`),
      { messages: [{ role: 'user', content: 'go' }], tools: [{ type: 'function', function: { name: 'generate_model' } }] },
    ]) expect((await POST(request(body))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reports missing configuration without a provider request', async () => {
    vi.stubEnv('DIRECTOR_PROVIDER', 'deepseek');
    vi.stubEnv('DEEPSEEK_API_KEY', '');
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('DEEPSEEK_API_KEY');
  });
});
