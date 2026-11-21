// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FxFetch } from 'libfx/browser';
import { NextRequest } from 'next/server';
import { POST as directorProxy } from '../app/api/llm/chat/completions/route';
import { ModelWorkflow, type ModelProvider, type ModelTask } from '../model/provider';

const fixture = vi.hoisted(() => ({ fetch: undefined as FxFetch | undefined }));
vi.mock('libfx/browser', async importOriginal => {
  const actual = await importOriginal<typeof import('libfx/browser')>();
  return {
    ...actual,
    createFxAgent: (options: Parameters<typeof actual.createFxAgent>[0]) => actual.createFxAgent({
      ...options, wasm: readFile(new URL('../../node_modules/libfx/fx-core.wasm', import.meta.url)), fetch: fixture.fetch,
    }),
  };
});
import { DirectorRuntime } from './runtime';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('real libfx wasm harness', () => {
  const liveDeepseek = process.env.PAJI_LIVE_DEEPSEEK === '1';
  it.each(liveDeepseek ? ['fixture', 'deepseek'] : ['fixture'])('sends vision input and executes all three tools with %s', async backend => {
    if (backend === 'deepseek') vi.stubEnv('DIRECTOR_PROVIDER', 'deepseek');
    vi.stubGlobal('window', { location: { origin: 'http://localhost:3000' } });
    vi.stubGlobal('FileReader', class {
      result = ''; onload?: () => void;
      async readAsDataURL(blob: Blob) { this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`; this.onload?.(); }
    });
    const requests: Record<string, unknown>[] = [];
    let step = 0;
    fixture.fetch = async (input, init) => {
      const rawBody = typeof init?.body === 'string' ? init.body : new TextDecoder().decode(init.body as Uint8Array);
      const body = JSON.parse(rawBody); requests.push({ ...body, requestUrl: String(input) });
      if (backend === 'deepseek') return directorProxy(new NextRequest(input, {
        method: 'POST', body: rawBody, signal: init.signal ?? undefined,
        headers: { 'Content-Type': 'application/json' },
      }));
      const names = ['generate_model', 'check_rig', 'rig_model'];
      const delta = step < 3 ? { role: 'assistant', tool_calls: [{ index: 0, id: `call_${step}`, type: 'function', function: { name: names[step], arguments: '{}' } }] } : { role: 'assistant', content: '模型与骨骼绑定已完成。' };
      const chunk = (data: unknown, finish: string | null) => `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'director', choices: [{ index: 0, delta: data, finish_reason: finish }] })}\n\n`;
      const text = chunk(delta, null) + chunk({}, step++ < 3 ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n';
      return new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });
    };
    const phases: string[] = [];
    const provider: ModelProvider = {
      generate: async () => 'generated', check: async () => 'checked', rig: async () => 'rigged',
      wait: async (id, _signal, emit) => {
        const task: ModelTask = { task_id: id, status: 'success', progress: 100, output: { riggable: true } };
        phases.push(id); emit(task); return task;
      }, download: async () => new Blob(['fixture']),
    };
    const assets: boolean[] = [];
    const image = new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==', 'base64')], 'actor.png', { type: 'image/png' });
    const workflow = new ModelWorkflow(provider, image, () => {}, async asset => { assets.push(asset.rigged); });
    const runtime = new DirectorRuntime(workflow);
    const emitted: string[] = [];
    try {
      expect(await DirectorRuntime.supported()).toBe(true);
      await runtime.run('生成模型并绑定骨骼', image, new AbortController().signal, event => emitted.push(event.text));
      expect(phases).toEqual(['generated', 'checked', 'rigged']);
      expect(assets).toEqual([false, true]);
      expect(emitted.filter(text => !['generate_model', 'check_rig', 'rig_model'].includes(text)).join('').trim()).not.toBe('');
      expect(JSON.stringify(requests[0])).toContain('image_url');
      expect(requests[0].requestUrl).toBe('http://localhost:3000/api/llm/chat/completions');
      if (backend === 'fixture') expect(requests).toHaveLength(4);
    } finally { await runtime.close(); }
  }, 90_000);
});
