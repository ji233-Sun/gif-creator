import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createLocalJWKSet, jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { HttpError } from './http';

const issuer = 'https://auth.openai.com';
const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
const resource = 'https://api.openai.com/v1';
const registrationClient = 'dynamic_agent_client';
const planScopes = ['resource.invoke', 'chatgpt.tokens.use.direct'];
const scopes = ['openid', 'profile', 'email', 'offline_access', ...planScopes].join(' ');
const callbackHost = '127.0.0.1';
const callbackPath = '/auth/callback';
const loginTtl = 5 * 60_000;
const accessTtl = 60 * 60_000;
const errorTtl = 2 * 60_000;
const maxSessions = 16;
const connectFailed = '无法连接 ChatGPT，请重试';
const scopeMissing = '未获得 ChatGPT 套餐使用权限';
const opaque = /^[A-Za-z0-9_-]{43}$/;

export const chatGptCookieName = 'paji_chatgpt_session';
export const chatGptCookieOptions = { httpOnly: true, sameSite: 'strict', path: '/api/llm' } as const;
export const chatGptCookieMaxAge = (loginTtl + accessTtl) / 1000;

type Connected = { state: 'connected'; token: string; scopes: Set<string> };
type Phase = { state: 'waiting'; abort: AbortController } | Connected | { state: 'error'; message: string };
type Session = { origin: string; phase: Phase; expiresAt: number; timer?: ReturnType<typeof setTimeout> };
type Status = { state: 'disconnected' | 'waiting' | 'connected' | 'error'; message?: string; model?: string };

// The management route and the inference route can be compiled into separate bundles.
const storeKey = Symbol.for('paji.chatgpt-session.v1');
const shared = globalThis as typeof globalThis & {
  [storeKey]?: { hostId: string; sessions: Map<string, Session> };
};
const { hostId, sessions } = shared[storeKey] ??= { hostId: `urn:uuid:${randomUUID()}`, sessions: new Map() };

export function chatGptLocalOrigin(request: NextRequest): string {
  // Only direct, plain-HTTP loopback access is supported. Forwarded headers cannot opt in.
  const host = request.headers.get('host')?.toLowerCase() ?? '';
  const match = /^(localhost|127\.0\.0\.1|\[::1\])(?::([1-9]\d{0,4}))?$/.exec(host);
  if (!match || Number(match[2]) > 65535 || request.nextUrl.protocol !== 'http:') {
    throw new HttpError(403, 'ChatGPT 登录仅支持本机访问');
  }
  const origin = new URL(`http://${host}`).origin;
  const suppliedOrigin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  const mutates = request.method !== 'GET' && request.method !== 'HEAD';
  if ((site !== null && site !== 'same-origin') ||
      ((mutates || suppliedOrigin !== null) && suppliedOrigin !== origin)) {
    throw new HttpError(403, '请求来源不受信任');
  }
  return origin;
}

function remove(id: string, session: Session) {
  if (sessions.get(id) !== session) return;
  sessions.delete(id);
  clearTimeout(session.timer);
  if (session.phase.state === 'waiting') session.phase.abort.abort();
}

function expireAt(id: string, session: Session, expiresAt: number) {
  clearTimeout(session.timer);
  session.expiresAt = expiresAt;
  session.timer = setTimeout(() => remove(id, session), Math.max(0, expiresAt - Date.now()));
  session.timer.unref();
}

function lookup(request: NextRequest, origin: string) {
  const id = request.cookies.get(chatGptCookieName)?.value;
  if (!id || !opaque.test(id)) return;
  const session = sessions.get(id);
  if (!session || session.origin !== origin) return;
  if (session.expiresAt <= Date.now()) { remove(id, session); return; }
  return { id, session };
}

export function chatGptStatus(request: NextRequest): Status {
  const phase = lookup(request, chatGptLocalOrigin(request))?.session.phase;
  if (!phase) return { state: 'disconnected' };
  if (phase.state === 'error') return { state: 'error', message: phase.message };
  return { state: phase.state };
}

export function disconnectChatGpt(request: NextRequest): void {
  const existing = lookup(request, chatGptLocalOrigin(request));
  if (existing) remove(existing.id, existing.session);
}

export function chatGptAccessToken(request: NextRequest): string {
  const phase = lookup(request, chatGptLocalOrigin(request))?.session.phase;
  if (phase?.state !== 'connected' || !planScopes.every(scope => phase.scopes.has(scope))) {
    throw new HttpError(401, '请先连接 ChatGPT');
  }
  return phase.token;
}

const endpoint = z.string().transform(value => new URL(value)).refine(url =>
  url.origin === issuer && !url.username && !url.password && !url.hash,
);
const discovery = z.object({
  issuer: z.literal(issuer), authorization_endpoint: endpoint, token_endpoint: endpoint, jwks_uri: endpoint,
});
const visible = (max: number) => z.string().min(1).max(max).refine(value => !/[^!-~]/.test(value));
const codeValue = visible(4_096);
const clientValue = visible(256);
const tokenValue = visible(32_768);
const tokenReply = z.object({
  access_token: tokenValue,
  id_token: tokenValue,
  token_type: z.string().refine(value => value.toLowerCase() === 'bearer'),
  expires_in: z.number().int().positive(),
  scope: z.string(),
  client_id: z.string().optional(),
  ext_agent_host_id: z.string().optional(),
});
const keySet = z.object({ keys: z.array(z.record(z.string(), z.unknown())).min(1).max(64) });

async function oauthJson(url: string | URL, signal: AbortSignal, body?: URLSearchParams): Promise<unknown> {
  const res = await fetch(url, {
    ...(body ? { method: 'POST', body } : {}), cache: 'no-store', redirect: 'error',
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    throw new Error(connectFailed);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    size += value.byteLength;
    if (size > 256 * 1024) {
      await reader.cancel();
      throw new Error(connectFailed);
    }
    chunks.push(value);
  }
}

function secret() { return randomBytes(32).toString('base64url'); }

function matches(random: string, received: unknown): boolean {
  return typeof received === 'string' && received.length === random.length && opaque.test(received) &&
    timingSafeEqual(Buffer.from(random), Buffer.from(received));
}

async function openCallback(
  origin: string, state: string, signal: AbortSignal,
  onResult: (result: URLSearchParams, redirectUri: string) => void, onFailure: () => void,
) {
  signal.throwIfAborted();
  let authority = '';
  let consumed = false;
  const server = createServer({ maxHeaderSize: 8_192 }, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Connection', 'close');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const target = req.url ?? '';
    const query = target.indexOf('?');
    const params = new URLSearchParams(query === -1 ? '' : target.slice(query + 1));
    const received = params.getAll('state');
    if (consumed || signal.aborted || req.method !== 'GET' || req.headers.host !== authority ||
        target.slice(0, query === -1 ? undefined : query) !== callbackPath ||
        received.length !== 1 || !matches(state, received[0])) {
      res.writeHead(400).end('Invalid sign-in callback.');
      return;
    }
    consumed = true;
    signal.removeEventListener('abort', stop);
    server.close();
    res.once('close', () => server.closeAllConnections());
    // Do not leave the one-time code in the address bar or send it as a Referer.
    res.writeHead(303, { Location: origin }).end();
    onResult(params, `http://${authority}${callbackPath}`);
  });
  function stop() {
    server.close();
    server.closeAllConnections();
  }
  server.maxConnections = 8;
  server.setTimeout(5_000, socket => socket.destroy());
  signal.addEventListener('abort', stop, { once: true });
  server.once('close', () => signal.removeEventListener('abort', stop));
  server.on('error', () => { if (authority && !consumed && !signal.aborted) onFailure(); });
  server.listen(0, callbackHost);
  await once(server, 'listening', { signal });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error(connectFailed);
  authority = `${callbackHost}:${address.port}`;
  server.unref();
  return `http://${authority}${callbackPath}`;
}

export async function startChatGpt(request: NextRequest): Promise<{ url: string; sessionId: string }> {
  const origin = chatGptLocalOrigin(request);
  const existing = lookup(request, origin);
  if (existing) remove(existing.id, existing.session);
  for (const [id, session] of sessions) if (session.expiresAt <= Date.now()) remove(id, session);
  if (sessions.size >= maxSessions) throw new HttpError(429, '登录请求过多，请稍后再试');

  const sessionId = secret();
  const abort = new AbortController();
  const session: Session = { origin, phase: { state: 'waiting', abort }, expiresAt: 0 };
  sessions.set(sessionId, session);
  expireAt(sessionId, session, Date.now() + loginTtl);
  const { signal } = abort;
  const state = secret();
  const verifier = secret();
  const nonce = secret();
  const onRequestAbort = () => remove(sessionId, session);
  request.signal.addEventListener('abort', onRequestAbort, { once: true });

  function finish(phase: Connected | { state: 'error'; message: string }, expiresAt: number) {
    if (sessions.get(sessionId) !== session) return;
    if (session.expiresAt <= Date.now()) { remove(sessionId, session); return; }
    session.phase = phase;
    expireAt(sessionId, session, expiresAt);
    abort.abort();
  }

  try {
    request.signal.throwIfAborted();
    const metadata = discovery.parse(await oauthJson(discoveryUrl, signal));
    async function exchange(result: URLSearchParams, redirectUri: string) {
      try {
        if (result.has('error')) throw new HttpError(401, 'ChatGPT 授权未完成');
        const code = result.getAll('code');
        const ids = result.getAll('client_id');
        const returnedIssuer = result.getAll('iss');
        if (code.length !== 1 || !codeValue.safeParse(code[0]).success ||
            ids.length !== 1 || ids[0] === registrationClient || !clientValue.safeParse(ids[0]).success ||
            returnedIssuer.length > 1 || (returnedIssuer.length === 1 && returnedIssuer[0] !== issuer)) {
          throw new Error(connectFailed);
        }
        const clientId = ids[0];
        const exchangedAt = Date.now();
        const grant = tokenReply.parse(await oauthJson(metadata.token_endpoint, signal, new URLSearchParams({
          grant_type: 'authorization_code', client_id: clientId, code: code[0], code_verifier: verifier,
          redirect_uri: redirectUri, resource,
        })));
        if ((grant.client_id !== undefined && grant.client_id !== clientId) ||
            (grant.ext_agent_host_id !== undefined && grant.ext_agent_host_id !== hostId)) throw new Error(connectFailed);
        const granted = new Set(grant.scope.split(/\s+/));
        if (!planScopes.every(scope => granted.has(scope))) throw new HttpError(401, scopeMissing);
        const keys = keySet.parse(await oauthJson(metadata.jwks_uri, signal));
        const { payload } = await jwtVerify(grant.id_token, createLocalJWKSet(keys), {
          issuer, audience: clientId, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'nonce'],
        });
        if (!matches(nonce, payload.nonce) || typeof payload.sub !== 'string' || !payload.sub ||
            typeof payload.iat !== 'number' || payload.iat > Date.now() / 1000 + 30 ||
            ((payload.azp !== undefined || (Array.isArray(payload.aud) && payload.aud.length > 1)) && payload.azp !== clientId)) {
          throw new Error(connectFailed);
        }
        const expiresAt = exchangedAt + Math.min(grant.expires_in * 1000, accessTtl);
        if (expiresAt <= Date.now()) throw new Error(connectFailed);
        finish({ state: 'connected', token: grant.access_token, scopes: granted }, expiresAt);
      } catch (error) {
        // Only locally selected messages cross the application boundary.
        const message = error instanceof HttpError && error.status === 401 ? error.message : connectFailed;
        finish({ state: 'error', message }, Date.now() + errorTtl);
      }
    }
    const redirectUri = await openCallback(origin, state, signal,
      (result, uri) => { void exchange(result, uri); },
      () => finish({ state: 'error', message: connectFailed }, Date.now() + errorTtl),
    );
    signal.throwIfAborted();
    const url = metadata.authorization_endpoint;
    for (const [key, value] of Object.entries({
      client_id: registrationClient, agent_name_hint: 'Paji', ext_agent_host_id: hostId,
      redirect_uri: redirectUri, response_type: 'code', scope: scopes, resource, state, nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    })) url.searchParams.set(key, value);
    return { url: url.toString(), sessionId };
  } catch {
    remove(sessionId, session);
    throw new HttpError(502, connectFailed);
  } finally {
    request.signal.removeEventListener('abort', onRequestAbort);
  }
}
