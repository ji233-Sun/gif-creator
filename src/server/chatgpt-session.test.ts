// @vitest-environment node
import { createHash } from 'node:crypto';
import { get } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, POST } from '../app/api/llm/chatgpt/route';
import { chatGptAccessToken } from './chatgpt-session';

const app = 'http://localhost:3000';
const issuer = 'https://auth.openai.com';
const metadata = {
  issuer,
  authorization_endpoint: `${issuer}/api/accounts/authorize`,
  token_endpoint: `${issuer}/api/accounts/oauth/token`,
  jwks_uri: `${issuer}/.well-known/jwks.json`,
};
const clientId = 'issued-client-fixture';
const accessToken = 'access-token-fixture';
const fixtureScopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const cookies = new Set<string>();
let signingKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwk: Awaited<ReturnType<typeof exportJWK>>;

beforeAll(async () => {
  signingKeys = await generateKeyPair('RS256');
  jwk = { ...await exportJWK(signingKeys.publicKey), kid: 'fixture', alg: 'RS256' };
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const cookie of cookies) DELETE(request('DELETE', cookie));
  cookies.clear();
  vi.unstubAllGlobals();
});

function request(method = 'GET', cookie?: string, override: Record<string, string> = {}) {
  return new NextRequest(`${app}/api/llm/chatgpt`, {
    method,
    headers: {
      host: 'localhost:3000', 'sec-fetch-site': 'same-origin',
      ...(method !== 'GET' ? { origin: app } : {}),
      ...(cookie ? { cookie } : {}),
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      ...override,
    },
    ...(method === 'POST' ? { body: JSON.stringify({ action: 'start' }) } : {}),
  });
}

function mockProvider(options: { expiresIn?: number; flaw?: 'scope' | 'nonce' | 'audience' | 'issuer' | 'signature' } = {}) {
  let authUrl: URL;
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' });
    switch (input.toString()) {
      case `${issuer}/.well-known/openid-configuration`: return Response.json(metadata);
      case metadata.jwks_uri:
        return Response.json({ keys: options.flaw === 'signature' ? [{ ...jwk, n: jwk.n!.replace(/^./, jwk.n![0] === 'A' ? 'B' : 'A') }] : [jwk] });
      case metadata.token_endpoint: {
        const body = new URLSearchParams(init?.body as URLSearchParams);
        expect(init?.method).toBe('POST');
        expect(Object.fromEntries(body)).toEqual({
          grant_type: 'authorization_code', client_id: clientId, code: 'fixture-code',
          redirect_uri: authUrl.searchParams.get('redirect_uri'), resource: 'https://api.openai.com/v1',
          code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        });
        expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(authUrl.searchParams.get('code_challenge'));
        const id = await new SignJWT({ nonce: options.flaw === 'nonce' ? 'bad-nonce' : authUrl.searchParams.get('nonce') })
          .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
          .setIssuer(options.flaw === 'issuer' ? 'https://other.invalid' : issuer)
          .setAudience(options.flaw === 'audience' ? 'other-client' : clientId)
          .setSubject('fixture-subject').setIssuedAt().setExpirationTime('5m').sign(signingKeys.privateKey);
        return Response.json({
          scope: options.flaw === 'scope' ? 'openid resource.invoke chatgpt.tokens.use.direct.other' : fixtureScopes,
          expires_in: options.expiresIn ?? 3600, token_type: 'Bearer', access_token: accessToken,
          client_id: clientId, ext_agent_host_id: authUrl.searchParams.get('ext_agent_host_id'), id_token: id, refresh_token: 'discard-me',
        });
      }
      default: throw new Error(`Unexpected upstream request: ${input}`);
    }
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, setAuthUrl: (url: URL) => { authUrl = url; } };
}

async function start(setAuthUrl: (url: URL) => void) {
  const response = await POST(request('POST'));
  expect(response.status).toBe(200);
  const rawCookie = response.headers.get('set-cookie')!;
  const cookie = rawCookie.split(';', 1)[0];
  cookies.add(cookie);
  const body = await response.json();
  expect(Object.keys(body)).toEqual(['url']);
  const url = new URL(body.url);
  setAuthUrl(url);
  return { url, cookie, rawCookie };
}

function sendCallback(auth: URL, state = auth.searchParams.get('state')!, host?: string) {
  const callback = new URL(auth.searchParams.get('redirect_uri')!);
  for (const [key, value] of Object.entries({ state, code: 'fixture-code', client_id: clientId })) callback.searchParams.set(key, value);
  return new Promise<{ status?: number; location?: string }>((resolve, reject) => {
    const pending = get(callback, { agent: false, headers: host ? { host } : undefined, timeout: 2_000 }, response => {
      response.resume();
      response.on('end', () => resolve({ status: response.statusCode, location: response.headers.location }));
    });
    pending.on('error', reject).on('timeout', () => pending.destroy(new Error('Callback timed out')));
  });
}

async function expectState(cookie: string, state: string) {
  await vi.waitFor(async () => expect(await GET(request('GET', cookie)).json()).toMatchObject({ state }));
}

function expectUnauthorized(cookie?: string) {
  expect(() => chatGptAccessToken(request('POST', cookie))).toThrow(expect.objectContaining({ status: 401 }));
}

describe('local ChatGPT OAuth', () => {
  it('clears secrets from the browser contract and binds the verified grant to its session and port', async () => {
    const { fetchMock, setAuthUrl } = mockProvider();
    const { url, cookie, rawCookie } = await start(setAuthUrl);
    expect(url.origin + url.pathname).toBe(metadata.authorization_endpoint);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'dynamic_agent_client', response_type: 'code', agent_name_hint: 'Paji',
      ext_agent_host_id: expect.stringMatching(/^urn:uuid:/), code_challenge_method: 'S256',
      redirect_uri: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/),
      scope: fixtureScopes, resource: 'https://api.openai.com/v1',
    });
    expect(new Set(['state', 'nonce', 'code_challenge'].map(key => url.searchParams.get(key))).size).toBe(3);
    expect(rawCookie).toMatch(/^paji_chatgpt_session=[A-Za-z0-9_-]{43};/);
    expect(rawCookie).toContain('HttpOnly');
    expect(rawCookie).toContain('SameSite=strict');
    expect(rawCookie).toContain('Path=/api/llm');
    await expectState(cookie, 'waiting');
    expectUnauthorized(cookie);
    expect((await sendCallback(url, 'wrong')).status).toBe(400);
    expect((await sendCallback(url, `${url.searchParams.get('state')}\n`)).status).toBe(400);
    expect((await sendCallback(url, undefined, 'other.invalid')).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await sendCallback(url)).toEqual({ status: 303, location: app });
    await expectState(cookie, 'connected');
    expect(await GET(request('GET', cookie)).json()).toEqual({ state: 'connected' });
    expect(chatGptAccessToken(request('POST', cookie))).toBe(accessToken);
    expectUnauthorized();
    expect(await GET(request('GET', cookie, { host: 'localhost:3001' })).json()).toEqual({ state: 'disconnected' });
    await expect(sendCallback(url)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    const disconnected = DELETE(request('DELETE', cookie));
    expect(disconnected.status).toBe(204);
    expect(disconnected.headers.get('set-cookie')).toContain('Max-Age=0');
    expectUnauthorized(cookie);
  });

  it.each(['scope', 'nonce', 'audience', 'issuer', 'signature'] as const)('rejects a grant with invalid %s', async flaw => {
    const { setAuthUrl } = mockProvider({ flaw });
    const { url, cookie } = await start(setAuthUrl);
    await sendCallback(url);
    await expectState(cookie, 'error');
    expectUnauthorized(cookie);
  });

  it('rejects forwarded-host and same-site/cross-origin mutations without discovery', async () => {
    const { fetchMock } = mockProvider();
    expect((await POST(request('POST', undefined, { host: 'public.invalid', 'x-forwarded-host': 'localhost:3000' }))).status).toBe(403);
    expect((await POST(request('POST', undefined, { origin: 'https://localhost:3000', 'x-forwarded-proto': 'https' }))).status).toBe(403);
    expect((await POST(request('POST', undefined, { origin: '' }))).status).toBe(403);
    expect(DELETE(request('DELETE', undefined, { origin: 'http://localhost:3001' })).status).toBe(403);
    expect(GET(request('GET', undefined, { 'sec-fetch-site': 'same-site' })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects discovery with an off-origin endpoint before opening a login', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ...metadata, token_endpoint: 'https://other.invalid/token' }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await POST(request('POST'))).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts an in-flight exchange and leaves no session on disconnect', async () => {
    let exchangeSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', (input: string | URL, init: RequestInit) => {
      if (input.toString() === `${issuer}/.well-known/openid-configuration`) return Response.json(metadata);
      if (input.toString() !== metadata.token_endpoint || !init.signal) throw new Error('Unexpected upstream request');
      const { signal } = init;
      exchangeSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const { url, cookie } = await start(() => {});
    await sendCallback(url);
    expect(exchangeSignal?.aborted).toBe(false);
    expect(DELETE(request('DELETE', cookie)).status).toBe(204);
    expect(exchangeSignal?.aborted).toBe(true);
    await expectState(cookie, 'disconnected');
  });

  it('expires grants at the provider expiry and closes a waiting listener on disconnect', async () => {
    const { setAuthUrl } = mockProvider({ expiresIn: 60 });
    const { url, cookie } = await start(setAuthUrl);
    await sendCallback(url);
    await expectState(cookie, 'connected');
    const then = Date.now() + 60_001;
    const now = vi.spyOn(Date, 'now').mockReturnValue(then);
    expectUnauthorized(cookie);
    await expectState(cookie, 'disconnected');
    now.mockRestore();

    const waiting = await start(setAuthUrl);
    expect(DELETE(request('DELETE', waiting.cookie)).status).toBe(204);
    await expect(sendCallback(waiting.url)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });
});
