import { MODEL_SESSION_HEADER } from './protocol';
import { SubmissionUnknownError, taskFailed, TaskFailedError, TaskUnavailableError, UnusableModelAssetError, type ModelProvider, type ModelTask } from './provider';

function delay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function errorBody(response: Response): Promise<{
  error?: string;
  submission?: 'rejected' | 'unknown';
  prerequisite?: 'generate' | 'check';
  asset?: 'unusable';
} | null> {
  return response.json().catch(() => null);
}

export class TripoProvider implements ModelProvider {
  private readonly session = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

  private request(url: string, signal: AbortSignal, body?: BodyInit) {
    return fetch(url, {
      method: body ? 'POST' : 'GET', body, signal,
      headers: { [MODEL_SESSION_HEADER]: this.session, ...(typeof body === 'string' && { 'Content-Type': 'application/json' }) },
    });
  }

  private async submit(body: BodyInit, signal: AbortSignal) {
    const response = await this.request('/api/model', signal, body).catch(() => { throw new SubmissionUnknownError(); });
    if (!response.ok) {
      const data = await errorBody(response);
      if (data?.submission !== 'rejected') throw new SubmissionUnknownError();
      const message = data.error || `请求失败（${response.status}）`;
      if (response.status === 410 && (data.prerequisite === 'generate' || data.prerequisite === 'check')) {
        throw new TaskUnavailableError(message, data.prerequisite);
      }
      throw new Error(message);
    }
    const data = await response.json().catch(() => null);
    const id: unknown = data?.task_id;
    if (typeof id !== 'string' || !id) throw new SubmissionUnknownError();
    return id;
  }

  async generate(image: File, signal: AbortSignal) {
    const form = new FormData();
    form.set('image', image);
    return this.submit(form, signal);
  }
  async check(taskId: string, signal: AbortSignal) {
    return this.submit(JSON.stringify({ action: 'check', taskId }), signal);
  }
  async rig(taskId: string, signal: AbortSignal) {
    return this.submit(JSON.stringify({ action: 'rig', taskId }), signal);
  }
  async wait(taskId: string, signal: AbortSignal, onProgress: (task: ModelTask) => void) {
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const response = await this.request(`/api/model?taskId=${encodeURIComponent(taskId)}`, signal);
      if (!response.ok) {
        const message = (await errorBody(response))?.error || `查询模型任务失败（${response.status}）`;
        if (response.status === 410) throw new TaskUnavailableError(message);
        throw new Error(message);
      }
      const task: ModelTask = await response.json();
      onProgress(task);
      if (task.status === 'success') return task;
      if (task.status === 'expired') throw new TaskUnavailableError(task.error_message ?? 'Tripo 上的原任务已失效。');
      if (taskFailed(task.status)) {
        throw new TaskFailedError(task.error_message ?? `Tripo 任务结束：${task.status}`);
      }
      await delay(2000, signal);
    }
    throw new Error('任务等待超过 15 分钟，请稍后重试以继续查询');
  }
  async download(taskId: string, signal: AbortSignal) {
    const response = await this.request(`/api/model/${encodeURIComponent(taskId)}/asset`, signal);
    if (!response.ok) {
      const data = await errorBody(response);
      const ErrorType = data?.asset === 'unusable' ? UnusableModelAssetError : Error;
      throw new ErrorType(data?.error || `模型下载失败（${response.status}）`);
    }
    return response.blob();
  }
}
