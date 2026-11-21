export type TaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'banned' | 'expired' | 'unknown';
export type ModelTask = {
  task_id: string;
  status: TaskStatus;
  progress: number;
  output?: { model_url?: string; riggable?: boolean; topology?: string; rig_type?: string };
  error_msg?: string;
};
export type ModelPhase = 'generate' | 'check' | 'rig';
export type Progress = { phase: ModelPhase; task: ModelTask };
export class TaskFailedError extends Error {}
export interface ModelProvider {
  generate(image: File, signal: AbortSignal): Promise<string>;
  check(taskId: string, signal: AbortSignal): Promise<string>;
  rig(taskId: string, signal: AbortSignal): Promise<string>;
  wait(taskId: string, signal: AbortSignal, onProgress: (task: ModelTask) => void): Promise<ModelTask>;
  download(taskId: string, signal: AbortSignal): Promise<Blob>;
}

export type ModelAsset = { taskId: string; glb: Blob; rigged: boolean };

export class ModelWorkflow {
  private taskIds: Partial<Record<ModelPhase, string>> = {};
  private completed: Partial<Record<ModelPhase, ModelTask>> = {};
  private assets: Partial<Record<'generate' | 'rig', ModelAsset>> = {};
  private running = false;
  constructor(
    private provider: ModelProvider,
    private image: File,
    private onProgress: (progress: Progress) => void,
    private onAsset: (asset: ModelAsset, signal: AbortSignal) => Promise<void>,
  ) {}

  get rigged() { return Boolean(this.assets.rig); }

  private async run(phase: ModelPhase, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.completed[phase]) return this.completed[phase]!;
    if (!this.taskIds[phase]) {
      this.taskIds[phase] = phase === 'generate'
        ? await this.provider.generate(this.image, signal)
        : phase === 'check'
          ? await this.provider.check(this.taskIds.generate!, signal)
          : await this.provider.rig(this.taskIds.generate!, signal);
    }
    try {
      const task = await this.provider.wait(this.taskIds[phase]!, signal, task => this.onProgress({ phase, task }));
      this.completed[phase] = task;
      return task;
    } catch (error) {
      // Failed upstream jobs need a new task; interrupted polling keeps the existing id.
      if (error instanceof TaskFailedError) delete this.taskIds[phase];
      throw error;
    }
  }

  async execute(phase: ModelPhase, signal: AbortSignal) {
    if (this.running) throw new Error('已有模型任务正在执行');
    this.running = true;
    try {
      if (phase !== 'generate' && !this.completed.generate) throw new Error('请先生成模型');
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
        signal.throwIfAborted();
        this.assets[phase] = asset;
      }
      return { taskId: task.task_id, rigged: phase === 'rig', loaded: true };
    } finally { this.running = false; }
  }
}
