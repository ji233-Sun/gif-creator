import { describe, expect, it, vi } from 'vitest';
import { MODEL_SESSION_HEADER } from './protocol';
import { ModelWorkflow, SubmissionUnknownError, TaskFailedError, TaskUnavailableError, UnusableModelAssetError, type ModelProvider, type ModelTask } from './provider';
import { TripoProvider } from './tripo';

function provider() {
  return {
    generate: vi.fn(async () => 'generated'), check: vi.fn(async () => 'checked'), rig: vi.fn(async () => 'rigged'),
    wait: vi.fn(async (id: string, _signal: AbortSignal, progress: (task: ModelTask) => void) => {
      const task: ModelTask = { task_id: id, status: 'success', progress: 100, output: { riggable: true } };
      progress(task); return task;
    }), download: vi.fn<ModelProvider['download']>(async () => new Blob(['glb'])),
  } satisfies ModelProvider;
}
const image = new File(['png'], 'actor.png', { type: 'image/png' });
type ModelWorkflowAsset = ConstructorParameters<typeof ModelWorkflow>[3];

describe('ModelWorkflow', () => {
  it('requires generation and rig check before rigging, then loads both GLBs once', async () => {
    const api = provider(), loaded = vi.fn(async () => {}), progress = vi.fn();
    const workflow = new ModelWorkflow(api, image, progress, loaded);
    const signal = new AbortController().signal;
    await expect(workflow.execute('rig', signal)).rejects.toThrow('先生成');
    await workflow.execute('generate', signal);
    await expect(workflow.execute('rig', signal)).rejects.toThrow('先确认');
    await workflow.execute('check', signal);
    await workflow.execute('rig', signal);
    await workflow.execute('rig', signal);
    expect(workflow.rigged).toBe(true);
    expect(api.generate).toHaveBeenCalledTimes(1);
    expect(api.rig).toHaveBeenCalledTimes(1);
    expect(api.rig).toHaveBeenCalledWith('checked', expect.any(AbortSignal));
    expect(loaded.mock.calls).toHaveLength(2);
    expect(api.download.mock.calls.map(call => call[0])).toEqual(['generated', 'rigged']);
    expect(progress).toHaveBeenCalledTimes(3);
  });
  it('does not dispatch a new task if stopped before submission starts', async () => {
    const api = provider(), workflow = new ModelWorkflow(api, image, () => {}, async () => {});
    const controller = new AbortController();
    const attempt = workflow.execute('generate', controller.signal);
    controller.abort();
    await expect(attempt).rejects.toThrow();
    expect(api.generate).not.toHaveBeenCalled();
    await expect(workflow.execute('generate', new AbortController().signal)).resolves.toMatchObject({ taskId: 'generated' });
    expect(api.generate).toHaveBeenCalledTimes(1);
  });
  it('keeps in-flight submission alive when stopped and continues using the same task id', async () => {
    const api = provider(), workflow = new ModelWorkflow(api, image, () => {}, async () => {});
    const controller = new AbortController();
    let accepted!: (id: string) => void;
    api.generate.mockReturnValueOnce(new Promise(resolve => { accepted = resolve; }));
    const initial = workflow.execute('generate', controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(initial).rejects.toThrow();
    expect(api.generate).toHaveBeenCalledWith(image, expect.objectContaining({ aborted: false }));
    expect(api.wait).not.toHaveBeenCalled();
    const resumed = workflow.execute('generate', new AbortController().signal);
    accepted('the-first-id');
    await expect(resumed).resolves.toMatchObject({ taskId: 'the-first-id' });
    expect(api.generate).toHaveBeenCalledTimes(1);
    expect(api.wait).toHaveBeenCalledTimes(1);
  });
  it('does not submit again if the outcome of task creation is unknown', async () => {
    const api = provider(), workflow = new ModelWorkflow(api, image, () => {}, async () => {});
    api.generate.mockRejectedValueOnce(new SubmissionUnknownError());
    const signal = new AbortController().signal;
    await expect(workflow.execute('generate', signal)).rejects.toBeInstanceOf(SubmissionUnknownError);
    await expect(workflow.execute('generate', signal)).rejects.toBeInstanceOf(SubmissionUnknownError);
    expect(api.generate).toHaveBeenCalledTimes(1);
  });
  it('retains task id after cancelled polling or network failure, avoiding another paid generation', async () => {
    const api = provider(), workflow = new ModelWorkflow(api, image, () => {}, async () => {});
    const aborted = new AbortController();
    api.wait.mockImplementationOnce(async () => { aborted.abort(); throw aborted.signal.reason; });
    await expect(workflow.execute('generate', aborted.signal)).rejects.toThrow();
    api.wait.mockRejectedValueOnce(new Error('network'));
    await expect(workflow.execute('generate', new AbortController().signal)).rejects.toThrow('network');
    await workflow.execute('generate', new AbortController().signal);
    expect(api.generate).toHaveBeenCalledTimes(1);
    expect(api.wait).toHaveBeenCalledTimes(3);
  });
  it('restarts a terminally failed task and retains completed model on rig failure', async () => {
    const api = provider(), workflow = new ModelWorkflow(api, image, () => {}, async () => {});
    const signal = new AbortController().signal;
    api.wait.mockRejectedValueOnce(new TaskFailedError('failed'));
    await expect(workflow.execute('generate', signal)).rejects.toThrow('failed');
    await workflow.execute('generate', signal);
    expect(api.generate).toHaveBeenCalledTimes(2);
    await workflow.execute('check', signal);
    api.wait.mockRejectedValueOnce(new TaskFailedError('rig failed'));
    await expect(workflow.execute('rig', signal)).rejects.toThrow('rig failed');
    expect(workflow.rigged).toBe(false);
    await workflow.execute('rig', signal);
    expect(api.generate).toHaveBeenCalledTimes(2);
    expect(api.rig).toHaveBeenCalledTimes(2);
  });
  it('rejects an unriggable character without submitting a rig task', async () => {
    const api = provider(), workflow = new ModelWorkflow(api, image, () => {}, async () => {});
    const signal = new AbortController().signal;
    await workflow.execute('generate', signal);
    api.wait.mockResolvedValueOnce({ task_id: 'checked', status: 'success', progress: 100, output: { riggable: false } });
    await expect(workflow.execute('check', signal)).rejects.toThrow('无法自动绑定');
    await expect(workflow.execute('rig', signal)).rejects.toThrow('先确认');
    expect(api.rig).not.toHaveBeenCalled();
  });
  it('retries asset download without recreating the finished cloud task', async () => {
    const api = provider(), workflow = new ModelWorkflow(api, image, () => {}, async () => {});
    api.download.mockRejectedValueOnce(new Error('download'));
    await expect(workflow.execute('generate', new AbortController().signal)).rejects.toThrow('download');
    expect(workflow.restartablePhase).toBe(null);
    await workflow.execute('generate', new AbortController().signal);
    expect(api.generate).toHaveBeenCalledTimes(1);
    expect(api.download).toHaveBeenCalledTimes(2);
  });
  it('recreates only an unusable rig task after explicit restart', async () => {
    const api = provider(), onAsset = vi.fn<ModelWorkflowAsset>(async () => {});
    const workflow = new ModelWorkflow(api, image, () => {}, onAsset);
    const signal = new AbortController().signal;
    await workflow.execute('generate', signal);
    await workflow.execute('check', signal);
    onAsset.mockRejectedValueOnce(new UnusableModelAssetError('corrupt'));
    await expect(workflow.execute('rig', signal)).rejects.toThrow('corrupt');
    expect(workflow.restartablePhase).toBe('rig');
    api.download.mockRejectedValueOnce(new UnusableModelAssetError('expired'));
    await expect(workflow.execute('rig', signal)).rejects.toThrow('expired');
    expect(api.rig).toHaveBeenCalledTimes(1);
    expect(onAsset.mock.calls.map(([asset]) => asset.rigged)).toEqual([false, true]);
    api.rig.mockResolvedValueOnce('rig-v2');
    await expect(workflow.restartPhase('rig', signal)).resolves.toMatchObject({ taskId: 'rig-v2', rigged: true });
    expect(workflow.restartablePhase).toBe(null);
    expect(workflow.rigged).toBe(true);
    expect(api.generate).toHaveBeenCalledTimes(1);
    expect(api.check).toHaveBeenCalledTimes(1);
    expect(api.rig).toHaveBeenCalledTimes(2);
    expect(api.rig).toHaveBeenLastCalledWith('checked', expect.any(AbortSignal));
  });
  it('only replaces a confirmed expired check and reuses the accepted GLB', async () => {
    const api = provider(), onAsset = vi.fn<ModelWorkflowAsset>(async () => {});
    const workflow = new ModelWorkflow(api, image, () => {}, onAsset);
    const signal = new AbortController().signal;
    await workflow.execute('generate', signal);
    await workflow.execute('check', signal);
    api.rig.mockRejectedValueOnce(new TaskUnavailableError('previous check expired', 'check'));
    await expect(workflow.execute('rig', signal)).rejects.toThrow('previous check expired');
    expect(workflow.restartablePhase).toBe('check');
    expect(() => workflow.restartPhase('rig', signal)).toThrow('没有可重新提交');
    api.check.mockResolvedValueOnce('new-check');
    await expect(workflow.restartPhase('check', signal)).resolves.toMatchObject({ riggable: true });
    expect(workflow.restartablePhase).toBe(null);
    expect(api.generate).toHaveBeenCalledTimes(1);
    expect(api.rig).toHaveBeenCalledTimes(1);
    expect(onAsset).toHaveBeenCalledTimes(1);
    await workflow.execute('rig', signal);
    expect(api.rig).toHaveBeenLastCalledWith('new-check', expect.any(AbortSignal));
  });
  it.each([['check', 'generate'], ['rig', 'check']] as const)('clears stale expiry after a successful %s, not a cached %s', async (phase, prerequisite) => {
    const api = provider(), workflow = new ModelWorkflow(api, image, () => {}, async () => {});
    const signal = new AbortController().signal;
    await workflow.execute('generate', signal);
    if (phase === 'rig') await workflow.execute('check', signal);
    api[phase].mockRejectedValueOnce(new TaskUnavailableError('temporarily unavailable', prerequisite));
    await expect(workflow.execute(phase, signal)).rejects.toThrow('temporarily unavailable');
    await workflow.execute(prerequisite, signal);
    expect(workflow.restartablePhase).toBe(prerequisite);
    await workflow.execute(phase, signal);
    expect(workflow.restartablePhase).toBeNull();
    expect(() => workflow.restartPhase(prerequisite, signal)).toThrow('没有可重新提交');
    expect(api[prerequisite]).toHaveBeenCalledTimes(1);
  });
  it('reuses the accepted rig after prerequisite recovery followed by a temporary download failure', async () => {
    const api = provider(), onAsset = vi.fn<ModelWorkflowAsset>(async () => {});
    const workflow = new ModelWorkflow(api, image, () => {}, onAsset);
    const signal = new AbortController().signal;
    await workflow.execute('generate', signal);
    await workflow.execute('check', signal);
    api.rig.mockRejectedValueOnce(new TaskUnavailableError('temporarily unavailable', 'generate'));
    await expect(workflow.execute('rig', signal)).rejects.toThrow('temporarily unavailable');
    expect(workflow.restartablePhase).toBe('generate');
    api.download.mockRejectedValueOnce(new Error('download failed'));
    await expect(workflow.execute('rig', signal)).rejects.toThrow('download failed');
    expect(workflow.restartablePhase).toBeNull();
    expect(() => workflow.restartPhase('generate', signal)).toThrow('没有可重新提交');
    expect(onAsset.mock.calls.map(([asset]) => asset.taskId)).toEqual(['generated']);
    await expect(workflow.execute('rig', signal)).resolves.toMatchObject({ taskId: 'rigged', rigged: true });
    expect(api.generate).toHaveBeenCalledTimes(1);
    expect(api.check).toHaveBeenCalledTimes(1);
    expect(api.rig).toHaveBeenCalledTimes(2); // Rejected preflight, then accepted once.
    expect(api.download.mock.calls.map(([id]) => id)).toEqual(['generated', 'rigged', 'rigged']);
  });
  it.each(['accepted', 'rejected'] as const)('settles a stopped rig submission that is later %s without stale paid recovery', async outcome => {
    const api = provider(), onRestartable = vi.fn();
    const workflow = new ModelWorkflow(api, image, () => {}, async () => {}, onRestartable);
    const signal = new AbortController().signal;
    await workflow.execute('generate', signal);
    await workflow.execute('check', signal);
    api.rig.mockRejectedValueOnce(new TaskUnavailableError('temporarily unavailable', 'generate'));
    await expect(workflow.execute('rig', signal)).rejects.toThrow('temporarily unavailable');
    expect(onRestartable).toHaveBeenLastCalledWith('generate');
    let finish!: () => void;
    api.rig.mockReturnValueOnce(new Promise((resolve, reject) => {
      finish = () => outcome === 'accepted' ? resolve('rigged') : reject(new TaskUnavailableError('check expired', 'check'));
    }));
    const controller = new AbortController();
    const attempt = workflow.execute('rig', controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(attempt).rejects.toThrow();
    expect(workflow.restartablePhase).toBeNull();
    expect(onRestartable).toHaveBeenLastCalledWith(null);
    expect(() => workflow.restartPhase('generate', signal)).toThrow('没有可重新提交');
    finish();
    if (outcome === 'accepted') {
      await expect(workflow.execute('rig', signal)).resolves.toMatchObject({ taskId: 'rigged', rigged: true });
      expect(onRestartable).toHaveBeenLastCalledWith(null);
    } else {
      await vi.waitFor(() => expect(onRestartable).toHaveBeenLastCalledWith('check'));
      expect(workflow.restartablePhase).toBe('check');
    }
    expect(api.generate).toHaveBeenCalledTimes(1);
    expect(api.check).toHaveBeenCalledTimes(1);
    expect(api.rig).toHaveBeenCalledTimes(2);
  });
});

describe('TripoProvider', () => {
  it('carries a per-workflow session through submission, polling and download', async () => {
    const original = globalThis.fetch;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ task_id: 'ref' }))
      .mockResolvedValueOnce(Response.json({ task_id: 'ref', status: 'success', progress: 100 })).mockResolvedValueOnce(new Response('asset'));
    globalThis.fetch = fetcher;
    try {
      const api = new TripoProvider();
      const signal = new AbortController().signal;
      const ref = await api.generate(image, signal);
      await api.wait(ref, signal, () => {});
      await api.download(ref, signal);
      const sessions = fetcher.mock.calls.map(([, init]) => new Headers(init?.headers).get(MODEL_SESSION_HEADER));
      expect(sessions[0]).toMatch(/^[a-f0-9]{32}$/);
      expect(new Set(sessions).size).toBe(1);
    } finally { globalThis.fetch = original; }
  });
  it('reports non-JSON download failures and treats an ambiguous create as unknown', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn<typeof fetch>().mockImplementation(async () => new Response('<html>error</html>', { status: 502 }));
    try {
      const api = new TripoProvider();
      const signal = new AbortController().signal;
      await expect(api.download('ref', signal)).rejects.toThrow('模型下载失败（502）');
      await expect(api.generate(image, signal)).rejects.toBeInstanceOf(SubmissionUnknownError);
    } finally { globalThis.fetch = original; }
  });
  it.each(['http', 'body'])('keeps a lost rig id (%s status) until the user confirms replacing it', async mode => {
    const original = globalThis.fetch;
    const creates: string[] = [];
    const rigQueries: string[] = [];
    let rigAttempts = 0;
    globalThis.fetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), 'http://localhost');
      if (init?.method === 'POST') {
        const phase = typeof init.body === 'string' ? JSON.parse(init.body).action : 'generate';
        creates.push(phase);
        return Response.json({ task_id: phase === 'rig' ? `rig${++rigAttempts}` : phase });
      }
      if (url.pathname.endsWith('/asset')) return new Response('test GLB');
      const task_id = url.searchParams.get('taskId');
      if (task_id?.startsWith('rig')) rigQueries.push(task_id);
      if (task_id === 'rig1') return mode === 'http'
        ? Response.json({ error: 'expired' }, { status: 410 })
        : Response.json({ task_id, status: 'expired', progress: 0 });
      return Response.json({ task_id, status: 'success', progress: 100, output: { riggable: true } });
    });
    try {
      const loaded: boolean[] = [];
      const workflow = new ModelWorkflow(new TripoProvider(), image, () => {}, async asset => { loaded.push(asset.rigged); });
      const signal = new AbortController().signal;
      await workflow.execute('generate', signal);
      await workflow.execute('check', signal);
      await expect(workflow.execute('rig', signal)).rejects.toBeInstanceOf(TaskUnavailableError);
      await expect(workflow.execute('rig', signal)).rejects.toBeInstanceOf(TaskUnavailableError);
      expect(workflow.restartablePhase).toBe('rig');
      expect(creates).toEqual(['generate', 'check', 'rig']);
      expect(loaded).toEqual([false]);
      await expect(workflow.restartPhase('rig', signal)).resolves.toMatchObject({ taskId: 'rig2', rigged: true });
      expect(creates).toEqual(['generate', 'check', 'rig', 'rig']);
      expect(rigQueries).toEqual(['rig1', 'rig1', 'rig2']);
      expect(loaded).toEqual([false, true]);
    } finally { globalThis.fetch = original; }
  });
  it('maps an explicitly rejected expired prerequisite to its phase', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => Response.json({ submission: 'rejected', prerequisite: 'check', error: 'expired' }, { status: 410 }));
    try {
      await expect(new TripoProvider().rig('check', new AbortController().signal)).rejects.toMatchObject({ prerequisite: 'check', message: 'expired' });
    } finally { globalThis.fetch = original; }
  });
  it.each(['failed', 'cancelled', 'banned'])('treats %s as terminal failure', async status => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => Response.json({ task_id: 't', status, progress: 0 }));
    try { await expect(new TripoProvider().wait('t', new AbortController().signal, () => {})).rejects.toBeInstanceOf(TaskFailedError); }
    finally { globalThis.fetch = original; }
  });
});
