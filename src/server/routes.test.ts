// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { POST as modelPost, GET as modelGet } from '../app/api/model/route';
import { POST as llmPost } from '../app/api/llm/chat/completions/route';
import { GET as assetGet } from '../app/api/model/[taskId]/asset/route';
import { MODEL_SESSION_HEADER } from '../model/protocol';
import { issueModelRef } from './model-access';

const session = 'a'.repeat(32);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==', 'base64');
let ip = 0;
function request(path: string, init?: RequestInit, address = `test-${++ip}`) {
  return new NextRequest(`http://localhost:3000${path}`, { ...init, signal: init?.signal ?? undefined, headers: { 'x-forwarded-for': address, [MODEL_SESSION_HEADER]: session, ...init?.headers } });
}
function action(action: 'check' | 'rig', taskId: string, headers: Record<string, string> = {}) {
  return request('/api/model', { method: 'POST', body: JSON.stringify({ action, taskId }), headers: { 'Content-Type': 'application/json', ...headers } });
}
function upload(bytes: Uint8Array = png, type = 'image/png') {
  const body = new FormData();
  body.set('image', new File([new Uint8Array(bytes)], 'actor', { type }));
  return request('/api/model', { method: 'POST', body });
}
function success(data: unknown) { return Response.json({ code: 0, data }); }
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('model proxy', () => {
  it('uploads an image and binds using the verified check result for the same model', async () => {
    vi.stubEnv('TRIPO_API_KEY', 'server-secret');
    vi.stubEnv('TRIPO_MODEL', '');
    vi.stubEnv('TRIPO_RIG_MODEL', '');
    const fetcher = vi.fn()
      .mockResolvedValueOnce(success({ file_token: 'file_1' })).mockResolvedValueOnce(success({ task_id: 'gen1' }))
      .mockResolvedValueOnce(success({ task_id: 'gen1', status: 'success' })).mockResolvedValueOnce(success({ task_id: 'check1' }))
      .mockResolvedValueOnce(success({ task_id: 'gen1', status: 'success' }))
      .mockResolvedValueOnce(success({ task_id: 'check1', status: 'success', output: { riggable: true, rig_type: 'quadruped' } }))
      .mockResolvedValueOnce(success({ task_id: 'rig1' }));
    vi.stubGlobal('fetch', fetcher);
    const generated = await modelPost(upload());
    expect(generated.status).toBe(200);
    const { task_id: modelRef } = await generated.json();
    expect(modelRef).not.toBe('gen1');
    expect(fetcher.mock.calls[0][0]).toBe('https://openapi.tripo3d.ai/v3/files');
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer server-secret');
    expect(fetcher.mock.calls[0][1].body.get('file')).toBeInstanceOf(File);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ input: 'file_1', texture: true, model: 'v2.5-20250123' });
    const checked = await modelPost(action('check', modelRef, { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }));
    expect(checked.status).toBe(200);
    const { task_id: checkRef } = await checked.json();
    const rigged = await modelPost(action('rig', checkRef));
    expect(rigged.status).toBe(200);
    expect(fetcher.mock.calls[3][0]).toContain('/v3/animations/rig-check');
    expect(fetcher.mock.calls.slice(4).map(([url]) => new URL(url).pathname)).toEqual(['/v3/tasks/gen1', '/v3/tasks/check1', '/v3/animations/rig']);
    expect(JSON.parse(fetcher.mock.calls[6][1].body)).toEqual({ input: 'gen1', out_format: 'glb', rig_type: 'quadruped', model: 'v2.5-20260210' });
  });
  it('rejects invalid uploads and cross-origin mutations before upstream calls', async () => {
    vi.stubEnv('TRIPO_API_KEY', 'server-secret');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await modelPost(upload(png.subarray(0, 8)))).status).toBe(400);
    const brokenForm = await modelPost(request('/api/model', { method: 'POST', body: 'invalid', headers: { 'Content-Type': 'multipart/form-data; boundary=fixture' } }));
    expect(brokenForm.status).toBe(400);
    expect(await brokenForm.json()).toMatchObject({ submission: 'rejected' });
    expect((await modelPost(request('/api/model', { method: 'POST', headers: { origin: 'https://untrusted.example' } }))).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('decodes WebP and uploads Tripo-compatible PNG rather than raw WebP', async () => {
    vi.stubEnv('TRIPO_API_KEY', 'server-secret');
    const webp = await sharp(png).webp().toBuffer();
    const fetcher = vi.fn().mockResolvedValueOnce(success({ file_token: 'f' })).mockResolvedValueOnce(success({ task_id: 'gen1' }));
    vi.stubGlobal('fetch', fetcher);
    expect((await modelPost(upload(webp, 'image/webp'))).status).toBe(200);
    const sent: File = fetcher.mock.calls[0][1].body.get('file');
    expect(sent.type).toBe('image/png');
    expect((await sharp(Buffer.from(await sent.arrayBuffer())).metadata()).format).toBe('png');
  });
  it('rejects unowned task references and missing prerequisite phases locally', async () => {
    vi.stubEnv('TRIPO_API_KEY', 'secret');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const foreign = { [MODEL_SESSION_HEADER]: 'b'.repeat(32) };
    const ref = issueModelRef(session, 'gen', 'generate');
    expect((await modelGet(request(`/api/model?taskId=${ref}`, { headers: foreign }))).status).toBe(404);
    expect((await modelGet(request('/api/model?taskId=gen'))).status).toBe(404);
    expect((await assetGet(request(`/api/model/${ref}/asset`, { headers: foreign }), { params: Promise.resolve({ taskId: ref }) })).status).toBe(404);
    expect((await modelPost(action('check', ref, foreign))).status).toBe(404);
    expect((await modelPost(action('rig', ref))).status).toBe(409);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not bind before a successful, positive check with a known rig type', async () => {
    vi.stubEnv('TRIPO_API_KEY', 'secret');
    const ref = issueModelRef(session, 'check', 'check', 'gen');
    const fetcher = vi.fn()
      .mockResolvedValueOnce(success({ task_id: 'gen', status: 'success' }))
      .mockResolvedValueOnce(success({ task_id: 'check', status: 'running', output: null }))
      .mockResolvedValueOnce(success({ task_id: 'gen', status: 'success' }))
      .mockResolvedValueOnce(success({ task_id: 'check', status: 'success', output: { riggable: false } }))
      .mockResolvedValueOnce(success({ task_id: 'gen', status: 'success' }))
      .mockResolvedValueOnce(success({ task_id: 'check', status: 'success', output: { riggable: true, rig_type: 'unrecognized' } }));
    vi.stubGlobal('fetch', fetcher);
    for (let i = 0; i < 3; i++) expect((await modelPost(action('rig', ref))).status).toBe(409);
    expect(fetcher.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });
  it('polls nullable results without consuming the creation allowance and passes vendor error fields', async () => {
    vi.stubEnv('TRIPO_API_KEY', 'secret');
    const ref = issueModelRef(session, 'gen', 'generate');
    const address = `poll-${++ip}`;
    const path = `/api/model?taskId=${ref}`;
    const fetcher = vi.fn().mockImplementation(async () => success({ task_id: 'gen', status: 'failed', progress: null, output: null, error_code: 1001, error_message: 'invalid image' }));
    vi.stubGlobal('fetch', fetcher);
    for (let i = 0; i < 12; i++) {
      const response = await modelGet(request(path, undefined, address));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ task_id: ref, status: 'failed', progress: 0, error_message: 'invalid image', error_code: 1001 });
    }
    fetcher.mockResolvedValueOnce(success({ task_id: 'gen', status: 'success' })).mockResolvedValueOnce(success({ task_id: 'check' }));
    expect((await modelPost(request('/api/model', { method: 'POST', body: JSON.stringify({ action: 'check', taskId: ref }) }, address))).status).toBe(200);
  });
  it('reports expired polling and identifies expired prerequisites without a new vendor POST', async () => {
    vi.stubEnv('TRIPO_API_KEY', 'secret');
    const generate = issueModelRef(session, 'gen', 'generate');
    const check = issueModelRef(session, 'check', 'check', 'gen');
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(success({ task_id: 'gen', status: 'expired' }))
      .mockResolvedValueOnce(success({ task_id: 'gen', status: 'success' }))
      .mockResolvedValueOnce(new Response(null, { status: 410 }));
    vi.stubGlobal('fetch', fetcher);
    expect((await modelGet(request(`/api/model?taskId=${generate}`))).status).toBe(410);
    for (const [op, ref, prerequisite] of [['check', generate, 'generate'], ['rig', check, 'check']] as const) {
      const response = await modelPost(action(op, ref));
      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({ prerequisite, submission: 'rejected' });
    }
    expect(fetcher.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'GET', 'GET', 'GET']);
  });
  it('reports the expired generated model even if its rig check is still valid, without submitting a rig', async () => {
    vi.stubEnv('TRIPO_API_KEY', 'secret');
    const ref = issueModelRef(session, 'check', 'check', 'gen');
    const fetcher = vi.fn<typeof fetch>(async input => {
      if (String(input).endsWith('/v3/tasks/check')) {
        return success({ task_id: 'check', status: 'success', output: { riggable: true, rig_type: 'biped' } });
      }
      return new Response(null, { status: 410 });
    });
    vi.stubGlobal('fetch', fetcher);
    const response = await modelPost(action('rig', ref));
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ prerequisite: 'generate', submission: 'rejected' });
    expect(fetcher.mock.calls.map(([input, init]) => [input, init?.method]))
      .toEqual([['https://openapi.tripo3d.ai/v3/tasks/gen', 'GET']]);
  });
  it('distinguishes a definite upstream POST rejection from an ambiguous server failure', async () => {
    vi.stubEnv('TRIPO_API_KEY', 'secret');
    const ref = issueModelRef(session, 'check', 'check', 'gen');
    const check = () => success({ task_id: 'check', status: 'success', output: { riggable: true, rig_type: 'biped' } });
    const model = () => success({ task_id: 'gen', status: 'success' });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(model()).mockResolvedValueOnce(check()).mockResolvedValueOnce(new Response(null, { status: 410 }))
      .mockResolvedValueOnce(model()).mockResolvedValueOnce(check()).mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    const rejected = await (await modelPost(action('rig', ref))).json();
    const unknown = await (await modelPost(action('rig', ref))).json();
    expect(rejected).toMatchObject({ submission: 'rejected' });
    expect(rejected).not.toHaveProperty('prerequisite');
    expect(unknown).toMatchObject({ submission: 'unknown' });
    expect(fetcher.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'GET', 'POST', 'GET', 'GET', 'POST']);
  });
  it('marks creation responses lost after submit as unknown, rather than safe to retry', async () => {
    vi.stubEnv('TRIPO_API_KEY', 'secret');
    const fetcher = vi.fn().mockResolvedValueOnce(success({ file_token: 'f' })).mockRejectedValueOnce(new Error('lost reply'));
    vi.stubGlobal('fetch', fetcher);
    expect(await (await modelPost(upload())).json()).toMatchObject({ submission: 'unknown' });
    expect(await (await modelPost(upload(png.subarray(0, 8)))).json()).toMatchObject({ submission: 'rejected' });
  });
  it('downloads only a task-derived GLB and does not forward credentials to storage', async () => {
    vi.stubEnv('TRIPO_API_KEY', 'secret');
    const glb = Buffer.alloc(12); glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(12, 8);
    const fetcher = vi.fn().mockResolvedValueOnce(success({ task_id: 'rig', status: 'success', output: { model_url: 'https://storage.example/model.glb' } })).mockResolvedValueOnce(new Response(glb));
    vi.stubGlobal('fetch', fetcher);
    const ref = issueModelRef(session, 'rig', 'rig');
    const response = await assetGet(request(`/api/model/${ref}/asset`), { params: Promise.resolve({ taskId: ref }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('model/gltf-binary');
    expect(fetcher.mock.calls[1][1].headers).toBeUndefined();
    expect(fetcher.mock.calls[1][1].redirect).toBe('error');
  });
  it.each(['not a URL', 'http://storage.example/model.glb'])('marks invalid asset URL %s unusable without requesting it', async model_url => {
    vi.stubEnv('TRIPO_API_KEY', 'secret');
    const ref = issueModelRef(session, 'rig', 'rig');
    const fetcher = vi.fn().mockResolvedValueOnce(success({ task_id: 'rig', status: 'success', output: { model_url } }));
    vi.stubGlobal('fetch', fetcher);
    const response = await assetGet(request(`/api/model/${ref}/asset`), { params: Promise.resolve({ taskId: ref }) });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ asset: 'unusable' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('distinguishes invalid or expired GLBs from temporary download failures', async () => {
    vi.stubEnv('TRIPO_API_KEY', 'secret');
    const task = { task_id: 'rig', status: 'success', output: { model_url: 'https://storage.example/model.glb' } };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(success(task)).mockResolvedValueOnce(new Response('not a GLB'))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(success(task)).mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(success(task)).mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    const ref = issueModelRef(session, 'rig', 'rig');
    const get = () => assetGet(request(`/api/model/${ref}/asset`), { params: Promise.resolve({ taskId: ref }) });
    for (const status of [502, 410, 403]) {
      const response = await get();
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ asset: 'unusable' });
    }
    const transient = await get();
    expect(transient.status).toBe(502);
    expect(await transient.json()).not.toHaveProperty('asset');
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
    const messages = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }] }];
    const tools = [{ type: 'function', function: { name: 'generate_model', parameters: { type: 'object' } } }];
    const response = await llmPost(request('/api/llm/chat/completions', { method: 'POST', body: JSON.stringify({ messages, tools, stream: true, model: 'untrusted', thinking: { type: 'enabled' } }) }));
    expect(response.status).toBe(200);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer fixture-key');
    expect(JSON.parse(options.body)).toEqual({ messages, tools, stream: true, model: 'deepseek-flash', max_tokens: 2048, thinking: { type: 'disabled' } });
  });
  it('rejects remote, malformed, truncated or oversized images and unrelated tools before contacting the provider', async () => {
    vi.stubEnv('DIRECTOR_PROVIDER', 'gateway');
    vi.stubEnv('VERCEL_AI_GATEWAY_KEY', 'secret');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    function vision(url: string) { return { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }] }; }
    const oversized = await sharp({ create: { width: 4097, height: 4096, channels: 3, background: '#fff' } }).png().toBuffer();
    for (const body of [
      vision('https://example.invalid/not-a-local-image'),
      vision(`data:image/png;base64,${png.subarray(0, 8).toString('base64')}`),
      vision(`data:image/png;base64,${oversized.toString('base64')}`),
      vision('data:image/png;base64,a'),
      vision('data:image/png;base64,YQ=='),
      vision(`data:image/jpeg;base64,${png.toString('base64')}`),
      { messages: [{ role: 'user', content: 'go' }], tools: [{ type: 'function', function: { name: 'unrelated' } }] },
    ]) {
      const response = await llmPost(request('/api/llm/chat/completions', { method: 'POST', body: JSON.stringify(body) }));
      expect(response.status).toBe(400);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reports missing configuration without exposing upstream credentials', async () => {
    vi.stubEnv('VERCEL_AI_GATEWAY_KEY', '');
    const response = await llmPost(request('/api/llm/chat/completions', { method: 'POST' }));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('VERCEL_AI_GATEWAY_KEY');
  });
});
