import { TaskFailedError, type ModelProvider, type ModelTask } from './provider';

function delay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function json<T>(url: string, signal: AbortSignal, body?: BodyInit): Promise<T> {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET', body, signal,
    headers: typeof body === 'string' ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `请求失败（${response.status}）`);
  return data;
}

export class TripoProvider implements ModelProvider {
  async generate(image: File, signal: AbortSignal) {
    const form = new FormData();
    form.set('image', image);
    return (await json<{ task_id: string }>('/api/model', signal, form)).task_id;
  }
  async check(taskId: string, signal: AbortSignal) {
    return (await json<{ task_id: string }>('/api/model', signal, JSON.stringify({ action: 'check', taskId }))).task_id;
  }
  async rig(taskId: string, signal: AbortSignal) {
    return (await json<{ task_id: string }>('/api/model', signal, JSON.stringify({ action: 'rig', taskId }))).task_id;
  }
  async wait(taskId: string, signal: AbortSignal, onProgress: (task: ModelTask) => void) {
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const task = await json<ModelTask>(`/api/model?taskId=${encodeURIComponent(taskId)}`, signal);
      onProgress(task);
      if (task.status === 'success') return task;
      if (['failed', 'cancelled', 'banned', 'expired'].includes(task.status)) {
        throw new TaskFailedError(task.error_msg ?? `Tripo 任务结束：${task.status}`);
      }
      await delay(2000, signal);
    }
    throw new Error('任务等待超过 15 分钟，请稍后重试以继续查询');
  }
  async download(taskId: string, signal: AbortSignal) {
    const response = await fetch(`/api/model/${encodeURIComponent(taskId)}/asset`, { signal });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error ?? '模型下载失败');
    }
    return response.blob();
  }
}
