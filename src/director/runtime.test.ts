// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as directorProxy } from '../app/api/llm/chat/completions/route';
import { ModelWorkflow, type ModelProvider, type ModelTask } from '../model/provider';

vi.mock('libfx/browser', async importOriginal => {
  const actual = await importOriginal<typeof import('libfx/browser')>();
  return {
    ...actual,
    createFxAgent: (options: Parameters<typeof actual.createFxAgent>[0]) => actual.createFxAgent({
      ...options, wasm: readFile(new URL('../../node_modules/libfx/fx-core.wasm', import.meta.url)),
    }),
  };
});
import { DirectorRuntime } from './runtime';

const realFetch = globalThis.fetch;
const image = new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==', 'base64')], 'actor.png', { type: 'image/png' });
const origin = 'http://localhost:3000';
const names = ['generate_model', 'check_rig', 'rig_model'];
function bodyOf(init?: RequestInit) {
  if (typeof init?.body === 'string') return init.body;
  return new TextDecoder().decode(init?.body as Uint8Array);
}
function modelReply(tool?: string, n = 0, args = '{}') {
  const delta = tool
    ? { role: 'assistant', tool_calls: [{ index: 0, id: `call_${n}`, type: 'function', function: { name: tool, arguments: args } }] }
    : { role: 'assistant', content: '模型与骨骼绑定已完成。' };
  const chunk = (data: unknown, finish: string | null) => `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'director', choices: [{ index: 0, delta: data, finish_reason: finish }] })}\n\n`;
  return new Response(chunk(delta, null) + chunk({}, tool ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}
function createRuntime() {
  const phases: string[] = [], assets: boolean[] = [];
  const provider = {
    generate: vi.fn(async () => 'generated'), check: vi.fn(async () => 'checked'), rig: vi.fn(async () => 'rigged'),
    wait: async (id: string, _signal: AbortSignal, emit: (task: ModelTask) => void) => {
      const task: ModelTask = { task_id: id, status: 'success', progress: 100, output: { riggable: true } };
      phases.push(id); emit(task); return task;
    }, download: async () => new Blob(['fixture']),
  } satisfies ModelProvider;
  const workflow = new ModelWorkflow(provider, image, () => {}, async asset => { assets.push(asset.rigged); });
  return { runtime: new DirectorRuntime(workflow), provider, workflow, phases, assets };
}

beforeEach(() => {
  vi.stubGlobal('window', { location: { origin } });
  vi.stubGlobal('FileReader', class {
    result = ''; onload?: () => void;
    async readAsDataURL(blob: Blob) { this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`; this.onload?.(); }
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('real libfx wasm harness', () => {
  const liveDeepseek = process.env.PAJI_LIVE_DEEPSEEK === '1';
  it.each(liveDeepseek ? ['fixture', 'deepseek'] : ['fixture'])('sends vision input and executes all three tools through the proxy with %s', async backend => {
    vi.stubEnv('DIRECTOR_PROVIDER', backend === 'fixture' ? 'gateway' : 'deepseek');
    if (backend === 'fixture') vi.stubEnv('VERCEL_AI_GATEWAY_KEY', 'fixture-key');
    const requests: string[] = [];
    let step = 0;
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      if (input === `${origin}/api/llm/chat/completions`) {
        requests.push(bodyOf(init));
        return directorProxy(new NextRequest(input, {
          method: 'POST', body: bodyOf(init), signal: init.signal ?? undefined,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      if (backend === 'deepseek' && input === 'https://api.deepseek.com/chat/completions') return realFetch(input, init);
      if (backend === 'fixture' && input === 'https://ai-gateway.vercel.sh/v1/chat/completions') {
        return modelReply(names[step], step++);
      }
      throw new Error(`Unexpected URL ${input}`);
    });
    const { runtime, phases, assets } = createRuntime();
    const emitted: string[] = [];
    expect(await DirectorRuntime.supported()).toBe(true);
    await runtime.run('生成模型并绑定骨骼', image, new AbortController().signal, event => emitted.push(event.text));
    expect(phases).toEqual(['generated', 'checked', 'rigged']);
    expect(assets).toEqual([false, true]);
    expect(emitted.filter(text => !names.includes(text)).join('').trim()).not.toBe('');
    expect(requests[0]).toContain('image_url');
    if (backend === 'fixture') expect(requests).toHaveLength(4);
  }, 90_000);

  it('aborts on the first proxy error and includes vision again on retry', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: string, init: RequestInit) => {
      requests.push(bodyOf(init));
      if (requests.length === 1) return Response.json({ error: '请在服务端配置导演服务' }, { status: 503 });
      return modelReply();
    }));
    const { runtime } = createRuntime();
    const emit = vi.fn();
    await expect(runtime.run('定妆', image, new AbortController().signal, emit)).rejects.toThrow('请在服务端配置导演服务');
    expect(requests).toHaveLength(1);
    expect(emit).not.toHaveBeenCalled();
    await expect(runtime.run('继续定妆', image, new AbortController().signal, emit)).rejects.toThrow('导演尚未完成骨骼绑定');
    expect(requests).toHaveLength(2);
    expect(requests.every(body => body.includes('image_url'))).toBe(true);
  });

  it('reports broken streams as a localized error without exposing libfx internals', async () => {
    const fetcher = vi.fn(async () => new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetcher);
    const { runtime, provider } = createRuntime();
    await expect(runtime.run('定妆', image, new AbortController().signal, () => {})).rejects.toThrow('AI 导演未返回完整结果');
    expect(provider.generate).not.toHaveBeenCalled();
  });
  it('stops the turn before another model request if a paid tool fails', async () => {
    const fetcher = vi.fn(async () => modelReply('generate_model'));
    vi.stubGlobal('fetch', fetcher);
    const { runtime, provider } = createRuntime();
    provider.generate.mockRejectedValueOnce(new Error('服务暂不可用'));
    await expect(runtime.run('定妆', image, new AbortController().signal, () => {})).rejects.toThrow('服务暂不可用');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([['generate_model', ''], ['generate_model', '{bad'], ['generate_model', '{"extra":true}'], ['not_a_tool', '{}']])('stops on invalid tool %s (%s) before a second model request', async (tool, args) => {
    const fetcher = vi.fn(async () => modelReply(tool, 0, args));
    vi.stubGlobal('fetch', fetcher);
    const { runtime, provider } = createRuntime();
    await expect(runtime.run('定妆', image, new AbortController().signal, () => {})).rejects.toThrow(/^AI 导演发出了无法执行的工具调用，请重试。$/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('reports the accepted rig even when final narration fails', async () => {
    let step = 0;
    const fetcher = vi.fn(async () => step < names.length ? modelReply(names[step], step++) : Response.json({ error: '上游暂不可用' }, { status: 502 }));
    vi.stubGlobal('fetch', fetcher);
    const { runtime, assets } = createRuntime();
    const emit = vi.fn();
    await expect(runtime.run('定妆', image, new AbortController().signal, emit)).resolves.toEqual({ narrationUnavailable: true });
    expect(assets).toEqual([false, true]);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(emit.mock.calls.some(([event]) => event.type === 'text')).toBe(false);
  });

  it('enforces the tool limit before entering the workflow for a seventh call', async () => {
    let step = 0;
    vi.stubGlobal('fetch', vi.fn(async () => modelReply('generate_model', step++)));
    const { runtime, provider, workflow } = createRuntime();
    const execute = vi.spyOn(workflow, 'execute');
    await expect(runtime.run('定妆', image, new AbortController().signal, () => {})).rejects.toThrow('导演已达到本次工具调用上限');
    expect(execute).toHaveBeenCalledTimes(6);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
});
