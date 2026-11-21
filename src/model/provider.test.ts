import { describe, expect, it, vi } from 'vitest';
import { ModelWorkflow, TaskFailedError, type ModelProvider, type ModelTask } from './provider';
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
    expect(api.rig).toHaveBeenCalledWith('generated', signal);
    expect(loaded.mock.calls).toHaveLength(2);
    expect(api.download.mock.calls.map(call => call[0])).toEqual(['generated', 'rigged']);
    expect(progress).toHaveBeenCalledTimes(3);
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
    await workflow.execute('generate', new AbortController().signal);
    expect(api.generate).toHaveBeenCalledTimes(1);
    expect(api.download).toHaveBeenCalledTimes(2);
  });
});

describe('TripoProvider', () => {
  it.each(['failed', 'cancelled', 'banned', 'expired'])('treats %s as terminal failure', async status => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => Response.json({ task_id: 't', status, progress: 0 }));
    try { await expect(new TripoProvider().wait('t', new AbortController().signal, () => {})).rejects.toBeInstanceOf(TaskFailedError); }
    finally { globalThis.fetch = original; }
  });
});
