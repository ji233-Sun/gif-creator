import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { addAbortListener } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { request } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { HttpError } from './http';

const nonPublic = new BlockList();
// Special-purpose IPv4 ranges, plus Azure's platform address.
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['168.63.129.16', 32], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.31.196.0', 24], ['192.52.193.0', 24], ['192.88.99.0', 24],
  ['192.168.0.0', 16], ['192.175.48.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) nonPublic.addSubnet(address, prefix);

const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6'); // Excludes mapped, translated, local and multicast addresses.
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['2620:4f:8000::', 48], ['3fff::', 20],
] as const) nonPublic.addSubnet(address, prefix, 'ipv6');

function publicAddress({ address, family }: LookupAddress) {
  if (isIP(address) !== family || address.includes('%')) return false;
  return family === 4 ? !nonPublic.check(address) : family === 6 &&
    globalV6.check(address, 'ipv6') && !nonPublic.check(address, 'ipv6');
}

const invalidEndpoint = () => new HttpError(400, '自定义 AI 服务地址必须是公网 HTTPS 地址');
const requestError = (signal: AbortSignal) => new HttpError(502, signal.aborted
  ? '自定义 AI 服务请求已取消' : '无法连接或读取自定义 AI 服务');

async function resolveAll(hostname: string, signal: AbortSignal): Promise<LookupAddress[]> {
  const family = isIP(hostname);
  if (family) return [{ address: hostname, family }];
  let abort: ReturnType<typeof addAbortListener> | undefined;
  // getaddrinfo itself cannot be canceled; after abort its result is never used.
  try {
    return await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => {
        abort = addAbortListener(signal, () => reject(requestError(signal)));
      }),
    ]);
  } catch { throw requestError(signal); }
  finally { abort?.[Symbol.dispose](); }
}

const controlledHeader = /^(?:host|content-length|transfer-encoding|connection|keep-alive|expect|te|trailer|upgrade|proxy-.*)$/;

function responseBody(message: IncomingMessage, signal: AbortSignal) {
  const chunks = message[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        signal.throwIfAborted();
        const { done, value } = await chunks.next();
        signal.throwIfAborted();
        if (!done) controller.enqueue(value);
        else if (message.complete) controller.close();
        else throw requestError(signal);
      } catch {
        message.destroy();
        controller.error(requestError(signal));
      }
    },
    cancel() { message.destroy(); },
  }, { highWaterMark: 0 });
}

export async function requestCustomEndpoint(url: URL, init: {headers: Record<string,string>; body: string; signal: AbortSignal}): Promise<Response> {
  const { signal, body } = init;
  if (signal.aborted) throw requestError(signal);
  const { protocol, hostname: host, port, pathname, search, username, password } = url;
  if (protocol !== 'https:' || !host || username || password || port === '0') throw invalidEndpoint();
  const hostname = host.startsWith('[') ? host.slice(1, -1) : host;
  const records = await resolveAll(hostname, signal);
  if (signal.aborted) throw requestError(signal);
  const [pinned] = records;
  if (!pinned || !records.every(publicAddress)) throw invalidEndpoint();

  const pinnedLookup: LookupFunction = (name, options, callback) => {
    if (name !== hostname || signal.aborted) callback(requestError(signal), '', 0);
    else if (options.all) callback(null, [pinned]);
    else callback(null, pinned.address, pinned.family);
  };

  try {
    const headers = new Headers(init.headers);
    for (const name of [...headers.keys()]) if (controlledHeader.test(name)) headers.delete(name);
    headers.set('content-length', String(Buffer.byteLength(body)));
    headers.set('accept-encoding', 'identity');
    if (signal.aborted) throw requestError(signal);
    return await new Promise<Response>((resolve, reject) => {
      let incoming: IncomingMessage | undefined;
      const req = request({
        protocol, hostname, port, path: pathname + search, method: 'POST',
        headers: Object.fromEntries(headers),
        // A one-off direct connection; do not use the global agent or its proxy settings.
        agent: false, family: pinned.family, lookup: pinnedLookup,
        servername: isIP(hostname) ? '' : hostname.replace(/\.$/, ''), rejectUnauthorized: true,
      }, message => {
        incoming = message;
        // The peer can fail before the consumer starts reading; don't emit an unhandled error.
        message.on('error', () => {});
        try {
          if (signal.aborted) throw requestError(signal);
          const status = message.statusCode ?? 0;
          if (status >= 300 && status < 400) throw new HttpError(502, '自定义 AI 服务不允许重定向');
          const headers = new Headers();
          for (const [name, values] of Object.entries(message.headers)) {
            for (const value of Array.isArray(values) ? values : [values]) {
              if (value !== undefined) headers.append(name, value);
            }
          }
          const noBody = status === 204 || status === 205;
          if (noBody) message.destroy();
          resolve(new Response(noBody ? null : responseBody(message, signal), { status, headers }));
        } catch (error) {
          message.destroy();
          reject(error);
        }
      });
      const fail = () => reject(requestError(signal));
      // The native request signal can stop listening after upload 'finish', before the response ends.
      const abort = addAbortListener(signal, () => {
        incoming?.destroy();
        req.destroy();
        fail();
      });
      req.on('error', fail);
      req.once('close', () => {
        abort[Symbol.dispose]();
        if (!incoming) fail();
      });
      try { req.end(body); } catch (error) { req.destroy(); reject(error); }
    });
  } catch (error) { throw error instanceof HttpError ? error : requestError(signal); }
}
