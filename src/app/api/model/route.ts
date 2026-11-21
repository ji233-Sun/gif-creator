import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { MAX_IMAGE_BYTES } from '@/lib/character-image';
import { taskFailed } from '@/model/provider';
import { failure, guard, HttpError, readJson } from '@/server/http';
import { issueModelRef, modelSession, readModelRef } from '@/server/model-access';
import { tripoImage } from '@/server/model-image';
import { readTripoTask, rigType, taskId, tripo, tripoKey, TripoRejectedError, TripoTaskUnavailableError } from '@/server/tripo';

export const runtime = 'nodejs';
const actionSchema = z.object({ action: z.enum(['check', 'rig']), taskId: z.string().max(320) });
const creationSchema = z.object({ task_id: taskId });

class PrerequisiteUnavailableError extends HttpError {
  constructor(readonly phase: 'generate' | 'check') {
    super(410, 'Tripo 上的前置任务已失效，请确认后重新提交；仍可下载已加载的模型。');
  }
}

async function readPrerequisite(id: string, phase: 'generate' | 'check', signal: AbortSignal) {
  const task = await readTripoTask(id, signal).catch(error => {
    if (error instanceof TripoTaskUnavailableError) throw new PrerequisiteUnavailableError(phase);
    throw error;
  });
  if (taskFailed(task.status)) throw new PrerequisiteUnavailableError(phase);
  if (task.status !== 'success') throw new HttpError(409, '任务还未完成必要的前置阶段');
  return task;
}

export async function GET(request: NextRequest) {
  try {
    guard(request, 120);
    const ref = request.nextUrl.searchParams.get('taskId');
    const { id } = readModelRef(request, ref);
    const task = await readTripoTask(id, request.signal);
    const output = task.output && { riggable: task.output.riggable, topology: task.output.topology, rig_type: task.output.rig_type };
    return NextResponse.json({ ...task, task_id: ref, output }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  let submitted = false;
  try {
    guard(request, 10);
    const session = modelSession(request);
    tripoKey();
    async function submit(path: string, body: object) {
      request.signal.throwIfAborted();
      submitted = true;
      return creationSchema.parse(await tripo(path, request.signal, body)).task_id;
    }
    if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
      // Count multipart overhead as well, before parsing an untrusted upload.
      const reader = request.body?.getReader();
      if (!reader) throw new HttpError(400, '请上传图片');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_IMAGE_BYTES + 64 * 1024) { await reader.cancel(); throw new HttpError(413, '图片不能超过 10 MiB'); }
        chunks.push(value);
      }
      const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers.get('content-type')! } })
        .formData().catch(() => { throw new HttpError(400, '图片表单格式无效'); });
      const file = form.get('image');
      if (!(file instanceof File) || file.size === 0) throw new HttpError(400, '请上传图片');
      if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, '图片不能超过 10 MiB');
      const image = await tripoImage(file);
      const upload = new FormData();
      upload.set('file', image, image.type === 'image/jpeg' ? 'character.jpg' : 'character.png');
      const { file_token } = z.object({ file_token: z.string().min(1) }).parse(await tripo('/v3/files', request.signal, upload));
      const id = await submit('/v3/generation/image-to-model', { input: file_token, model: process.env.TRIPO_MODEL?.trim() || 'v2.5-20250123', texture: true, pbr: true });
      return NextResponse.json({ task_id: issueModelRef(session, id, 'generate') });
    }
    const parsed = actionSchema.safeParse(await readJson(request, 4096));
    if (!parsed.success) throw new HttpError(400, '任务参数无效');
    const { action, taskId: ref } = parsed.data;
    const { id, phase, sourceId } = readModelRef(request, ref);
    if (action === 'check' ? phase !== 'generate' : phase !== 'check' || !sourceId) {
      throw new HttpError(409, '任务还未完成必要的前置阶段');
    }
    const modelId = action === 'check' ? id : sourceId;
    // The check and its input model can expire independently. Recover the
    // earlier prerequisite first and share one deadline across these reads.
    const preflight = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
    await readPrerequisite(modelId, 'generate', preflight);
    if (action === 'check') {
      const checkId = await submit('/v3/animations/rig-check', { input: modelId });
      return NextResponse.json({ task_id: issueModelRef(session, checkId, 'check', modelId) });
    }
    const check = await readPrerequisite(id, 'check', preflight);
    const type = rigType.safeParse(check.output?.rig_type);
    if (check.output?.riggable !== true || !type.success) throw new HttpError(409, 'Tripo 未确认该模型支持的绑骨类型');
    const rigId = await submit('/v3/animations/rig', {
      input: modelId, rig_type: type.data, model: process.env.TRIPO_RIG_MODEL?.trim() || 'v2.5-20260210', out_format: 'glb',
    });
    return NextResponse.json({ task_id: issueModelRef(session, rigId, 'rig') });
  } catch (error) {
    return failure(error, {
      submission: submitted && !(error instanceof TripoRejectedError) ? 'unknown' : 'rejected',
      ...(error instanceof PrerequisiteUnavailableError && { prerequisite: error.phase }),
    });
  }
}
