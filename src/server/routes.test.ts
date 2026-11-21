// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as modelPost, GET as modelGet } from '../app/api/model/route';
import { POST as llmPost } from '../app/api/llm/chat/completions/route';
import { GET as assetGet } from '../app/api/model/[taskId]/asset/route';

let ip = 0;
function request(path: string, init?: RequestInit, address = `test-${++ip}`) {
  return new NextRequest(`http://localhost:3000${path}`, { ...init, signal: init?.signal ?? undefined, headers: { 'x-forwarded-for': address, ...init?.headers } });
}
function success(data: unknown) { return Response.json({ code: 0, data }); }
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('model proxy', () => {
  it('uploads image bytes, creates generation, then checks and rigs using v3 contracts', async () => {
    vi.stubEnv('TRIPO_API_KEY', 'server-secret');
    const fetcher = vi.fn().mockResolvedValueOnce(success({ file_token: 'file_1' })).mockResolvedValueOnce(success({ task_id: 'gen1' })).mockResolvedValueOnce(success({ task_id: 'check1' })).mockResolvedValueOnce(success({ task_id: 'rig1' }));
    vi.stubGlobal('fetch', fetcher);
    const form = new FormData();
    form.set('image', new File([new Uint8Array([137,80,78,71,13,10,26,10])], 'actor.png', { type: 'image/png' }));
    const generated = await modelPost(request('/api/model', { method: 'POST', body: form }));
    expect(generated.status).toBe(200);
    expect(await generated.json()).toEqual({ task_id: 'gen1' });
    expect(fetcher.mock.calls[0][0]).toBe('https://openapi.tripo3d.ai/v3/files');
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer server-secret');
    expect(fetcher.mock.calls[0][1].body.get('file')).toBeInstanceOf(File);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ input: 'file_1', texture: true });
    for (const action of ['check', 'rig']) {
      const response = await modelPost(request('/api/model', { method: 'POST', body: JSON.stringify({ action, taskId: 'gen1' }), headers: { 'Content-Type': 'application/json' } }));
      expect(response.status).toBe(200);
    }
    expect(fetcher.mock.calls[2][0]).toContain('/v3/animations/rig-check');
    expect(JSON.parse(fetcher.mock.calls[3][1].body)).toMatchObject({ input: 'gen1', out_format: 'glb' });
  });
  it('rejects invalid uploads and cross-origin mutations before upstream calls', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const form = new FormData(); form.set('image', new File(['bad png'], 'actor.png', { type: 'image/png' }));
    expect((await modelPost(request('/api/model', { method: 'POST', body: form }))).status).toBe(400);
    expect((await modelPost(request('/api/model', { method: 'POST', headers: { origin: 'https://untrusted.example' } }))).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('accepts the browser Host origin when Next rewrites its internal URL', async () => {
    vi.stubEnv('TRIPO_API_KEY', 'secret');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(success({ task_id: 'check' })));
    const response = await modelPost(request('/api/model', { method: 'POST', headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }, body: JSON.stringify({ action: 'check', taskId: 'gen' }) }));
    expect(response.status).toBe(200);
  });
  it('polling does not consume the task creation allowance', async () => {
    vi.stubEnv('TRIPO_API_KEY', 'secret');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => init.method === 'GET' ? success({ task_id: 'gen', status: 'running', progress: 20 }) : success({ task_id: 'rig' })));
    const address = `poll-${++ip}`;
    for (let i = 0; i < 12; i++) expect((await modelGet(request('/api/model?taskId=gen', undefined, address))).status).toBe(200);
    const response = await modelPost(request('/api/model', { method: 'POST', body: JSON.stringify({ action: 'rig', taskId: 'gen' }) }, address));
    expect(response.status).toBe(200);
  });
  it('downloads only a task-derived GLB and does not forward credentials to storage', async () => {
    vi.stubEnv('TRIPO_API_KEY', 'secret');
    const glb = Buffer.alloc(12); glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(12, 8);
    const fetcher = vi.fn().mockResolvedValueOnce(success({ task_id: 'rig', status: 'success', output: { model_url: 'https://storage.example/model.glb' } })).mockResolvedValueOnce(new Response(glb));
    vi.stubGlobal('fetch', fetcher);
    const response = await assetGet(request('/api/model/rig/asset'), { params: Promise.resolve({ taskId: 'rig' }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('model/gltf-binary');
    expect(fetcher.mock.calls[1][1].headers).toBeUndefined();
    expect(fetcher.mock.calls[1][1].redirect).toBe('error');
  });
});

describe('LLM proxy', () => {
  it('pins server model, injects server key and streams the response', async () => {
    vi.stubEnv('VERCEL_AI_GATEWAY_KEY', 'secret'); vi.stubEnv('DIRECTOR_MODEL', 'configured-model');
    const fetcher = vi.fn().mockResolvedValue(new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })); vi.stubGlobal('fetch', fetcher);
    const response = await llmPost(request('/api/llm/chat/completions', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'go' }], model: 'untrusted', stream: true, max_tokens: 999999 }) }));
    expect(response.status).toBe(200); expect(await response.text()).toContain('[DONE]');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ model: 'configured-model', max_tokens: 2048 });
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer secret');
  });
  it('uses the official DeepSeek endpoint and keeps model and thinking mode server-controlled', async () => {
    vi.stubEnv('DIRECTOR_PROVIDER', 'deepseek');
    vi.stubEnv('DEEPSEEK_API_KEY', 'fixture-key');
    vi.stubEnv('DIRECTOR_MODEL', '');
    const fetcher = vi.fn().mockResolvedValue(new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetcher);
    const messages = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,fixture' } }] }];
    const tools = [{ type: 'function', function: { name: 'generate_model', parameters: { type: 'object' } } }];
    const response = await llmPost(request('/api/llm/chat/completions', { method: 'POST', body: JSON.stringify({ messages, tools, stream: true, model: 'untrusted', thinking: { type: 'enabled' } }) }));
    expect(response.status).toBe(200);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer fixture-key');
    expect(JSON.parse(options.body)).toEqual({ messages, tools, stream: true, model: 'deepseek-flash', max_tokens: 2048, thinking: { type: 'disabled' } });
  });
  it('reports missing configuration without exposing upstream credentials', async () => {
    vi.stubEnv('VERCEL_AI_GATEWAY_KEY', '');
    const response = await llmPost(request('/api/llm/chat/completions', { method: 'POST' }));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('VERCEL_AI_GATEWAY_KEY');
  });
});
