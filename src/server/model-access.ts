import { createHmac, timingSafeEqual } from 'node:crypto';
import { MODEL_SESSION_HEADER } from '@/model/protocol';
import type { ModelPhase } from '@/model/provider';
import { HttpError } from './http';
import { tripoKey } from './tripo';

const sessionPattern = /^[0-9a-f]{32}$/;
const refPattern = /^([a-zA-Z0-9_-]{1,128})\.(generate|check|rig)\.([a-zA-Z0-9_-]{0,128})\.([a-zA-Z0-9_-]{43})$/;

export function modelSession(request: Request) {
  const session = request.headers.get(MODEL_SESSION_HEADER);
  if (!session || !sessionPattern.test(session)) throw new HttpError(403, '当前页面没有模型任务访问权限');
  return session;
}

// Keep authorization stateless across proxy instances. A task reference alone
// is insufficient: it is signed for the in-memory session of its uploader.
function signature(session: string, claim: string) {
  return createHmac('sha256', tripoKey()).update('paji-model-task/v1\n').update(session).update('\n').update(claim).digest('base64url');
}

export function issueModelRef(session: string, id: string, phase: ModelPhase, sourceId = '') {
  const claim = `${id}.${phase}.${sourceId}`;
  return `${claim}.${signature(session, claim)}`;
}

export function readModelRef(request: Request, token: string | null) {
  const session = modelSession(request);
  const match = token && refPattern.exec(token);
  if (!match) throw new HttpError(404, '当前页面没有此模型任务');
  const [, id, phase, sourceId, received] = match;
  const expected = signature(session, token.slice(0, -(received.length + 1)));
  if (!timingSafeEqual(Buffer.from(received), Buffer.from(expected))) throw new HttpError(404, '当前页面没有此模型任务');
  return { session, id, phase, sourceId };
}
