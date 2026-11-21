export type TaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'banned' | 'expired' | 'unknown';
export type ModelTask = {
  task_id: string;
  status: TaskStatus;
  progress: number;
  output?: { riggable?: boolean; topology?: string; rig_type?: string };
  error_message?: string;
  error_code?: string | number;
};
const MODEL_PHASES = ['generate', 'check', 'rig'] as const;
export type ModelPhase = typeof MODEL_PHASES[number];
export type AssetPhase = Exclude<ModelPhase, 'check'>;
export type Progress = { phase: ModelPhase; task: ModelTask };
export const taskFailed = (status: TaskStatus) => ['failed', 'cancelled', 'banned', 'expired'].includes(status);
export class TaskFailedError extends Error {}
export class TaskUnavailableError extends Error {
  constructor(message: string, readonly prerequisite?: 'generate' | 'check') { super(message); }
}
export class UnusableModelAssetError extends Error {}
export class SubmissionUnknownError extends Error {
  constructor() {
    super('Tripo 未确认上次提交的结果。为避免重复消耗额度，当前演员不会重新提交这一步，请先查看 Tripo 任务记录。');
  }
}
export interface ModelProvider {
  // A failed create whose outcome is ambiguous must reject with SubmissionUnknownError.
  generate(image: File, signal: AbortSignal): Promise<string>;
  check(modelTaskId: string, signal: AbortSignal): Promise<string>;
  rig(checkTaskId: string, signal: AbortSignal): Promise<string>;
  wait(taskId: string, signal: AbortSignal, onProgress: (task: ModelTask) => void): Promise<ModelTask>;
  download(taskId: string, signal: AbortSignal): Promise<Blob>;
}

export type ModelAsset = { taskId: string; glb: Blob; rigged: boolean };

function waitForSubmission(submission: Promise<string>, signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    submission.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

export class ModelWorkflow {
  private submissions: Partial<Record<ModelPhase, Promise<string>>> = {};
  private completed: Partial<Record<ModelPhase, ModelTask>> = {};
  private assets: Partial<Record<AssetPhase, ModelAsset>> = {};
  private unavailablePhase: ModelPhase | null = null;
  private uncertainSubmission: SubmissionUnknownError | undefined;
  private pendingSubmissions = 0;
  private running = false;
  constructor(
    private provider: ModelProvider,
    private image: File,
    private onProgress: (progress: Progress) => void,
    private onAsset: (asset: ModelAsset, signal: AbortSignal) => Promise<void>,
    private onRestartableChange?: (phase: ModelPhase | null) => void,
  ) {}

  get rigged() { return Boolean(this.assets.rig); }
  get restartablePhase() {
    return this.pendingSubmissions || this.uncertainSubmission ? null : this.unavailablePhase;
  }

  private notifyRestartable() { this.onRestartableChange?.(this.restartablePhase); }

  assertCanContinue() {
    if (this.uncertainSubmission) throw this.uncertainSubmission;
  }

  restartPhase(phase: ModelPhase, signal: AbortSignal) {
    signal.throwIfAborted();
    this.assertCanContinue();
    if (this.running || this.restartablePhase !== phase) throw new Error('当前没有可重新提交的模型任务');
    // Called only after explicit confirmation. Keep earlier steps; later
    // task references depend on the step being replaced. The UI retains the
    // last viewable GLB until a replacement is accepted by the stage.
    for (const step of MODEL_PHASES.slice(MODEL_PHASES.indexOf(phase))) {
      delete this.submissions[step];
      delete this.completed[step];
      if (step !== 'check') delete this.assets[step];
    }
    this.unavailablePhase = null;
    return this.execute(phase, signal);
  }

  private submit(phase: ModelPhase, waiter: AbortSignal) {
    // A stopped waiter cannot replace a prerequisite while its dependent
    // submission may still be accepted remotely.
    this.pendingSubmissions++;
    this.notifyRestartable();
    return Promise.resolve().then(() => {
      waiter.throwIfAborted();
      // Once dispatched, a paid submission must outlive a stopped waiter.
      const signal = AbortSignal.timeout(150_000);
      if (phase === 'generate') return this.provider.generate(this.image, signal);
      if (phase === 'check') return this.provider.check(this.completed.generate!.task_id, signal);
      return this.provider.rig(this.completed.check!.task_id, signal);
    }).then(taskId => {
      // A new task ID proves its prerequisites passed preflight. Its own
      // usability still depends on polling and, for assets, stage validation.
      const prerequisite = MODEL_PHASES[MODEL_PHASES.indexOf(phase) - 1];
      if (prerequisite) this.clearUnavailableThrough(prerequisite);
      return taskId;
    }).catch(error => {
      if (error instanceof SubmissionUnknownError) this.uncertainSubmission = error;
      else {
        delete this.submissions[phase];
        if (error instanceof TaskUnavailableError) this.unavailablePhase = error.prerequisite ?? phase;
      }
      throw error;
    }).finally(() => {
      this.pendingSubmissions--;
      this.notifyRestartable();
    });
  }

  private clearUnavailableThrough(phase: ModelPhase) {
    if (this.unavailablePhase && MODEL_PHASES.indexOf(this.unavailablePhase) <= MODEL_PHASES.indexOf(phase)) {
      this.unavailablePhase = null;
    }
  }

  private async run(phase: ModelPhase, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.completed[phase]) return this.completed[phase]!;
    const taskId = await waitForSubmission(this.submissions[phase] ??= this.submit(phase, signal), signal);
    signal.throwIfAborted();
    try {
      const task = await this.provider.wait(taskId, signal, task => this.onProgress({ phase, task }));
      this.completed[phase] = task;
      if (phase === 'check') this.clearUnavailableThrough(phase);
      return task;
    } catch (error) {
      // Failed upstream jobs need a new task; interrupted polling keeps the existing id.
      if (error instanceof TaskFailedError) delete this.submissions[phase];
      throw error;
    }
  }

  async execute(phase: ModelPhase, signal: AbortSignal) {
    this.assertCanContinue();
    if (this.running) throw new Error('已有模型任务正在执行');
    this.running = true;
    try {
      if (phase !== 'generate' && !this.assets.generate) throw new Error('请先生成模型');
      if (phase === 'rig' && this.completed.check?.output?.riggable !== true) throw new Error('请先确认模型可绑定骨骼');
      const task = await this.run(phase, signal);
      if (phase === 'check') {
        if (task.output?.riggable !== true) throw new Error('该模型无法自动绑定骨骼，请换用四肢清晰、完整的角色图');
        return { riggable: true, topology: task.output.topology ?? task.output.rig_type };
      }
      if (!this.assets[phase]) {
        const glb = await this.provider.download(task.task_id, signal);
        signal.throwIfAborted();
        const asset = { taskId: task.task_id, glb, rigged: phase === 'rig' };
        await this.onAsset(asset, signal);
        this.assets[phase] = asset;
        this.clearUnavailableThrough(phase);
      }
      return { taskId: task.task_id, rigged: phase === 'rig', loaded: true };
    } catch (error) {
      if (error instanceof TaskUnavailableError) this.unavailablePhase = error.prerequisite ?? phase;
      else if (error instanceof UnusableModelAssetError) this.unavailablePhase = phase;
      throw error;
    } finally {
      this.running = false;
      this.notifyRestartable();
    }
  }
}
