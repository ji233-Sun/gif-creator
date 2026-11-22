// @vitest-environment node
import type { LookupAddress } from 'node:dns';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestCustomEndpoint } from './custom-ai-endpoint';
import { HttpError } from './http';

const { lookup, request } = vi.hoisted(() => ({
  lookup: vi.fn<(hostname: string, options: { all: true }) => Promise<LookupAddress[]>>(),
  request: vi.fn<(options: RequestOptions, onResponse: (message: IncomingMessage) => void) => unknown>(),
}));
vi.mock('node:dns/promises', () => ({ lookup }));
vi.mock('node:https', () => ({ request }));

const endpoint = 'https://provider.example:8443/v1/chat?mode=stream';
const publicV4 = { address: '8.8.8.8', family: 4 };
const publicV6 = { address: '2606:4700::1111', family: 6 };
const headers = { Authorization: 'Bearer mock-key', 'Content-Type': 'application/json' };
const body = '{"image":"mock 图"}';
const send = (url = endpoint, signal = new AbortController().signal, extraHeaders = {}) =>
  requestCustomEndpoint(new URL(url), { body, headers: { ...headers, ...extraHeaders }, signal });

beforeEach(() => {
  lookup.mockReset().mockResolvedValue([publicV4]);
  request.mockReset().mockImplementation(() => { throw new Error('Unexpected HTTPS request'); });
});

function wire(statusCode = 200, responseHeaders: IncomingMessage['headers'] = { 'content-type': 'text/event-stream' }) {
  const incoming = Object.assign(new PassThrough(), { statusCode, headers: responseHeaders, complete: true });
  const outgoing = new EventEmitter();
  const end = vi.fn();
  let respond!: () => void;
  let started!: (options: RequestOptions) => void;
  const opened = new Promise<RequestOptions>(resolve => { started = resolve; });
  const destroy = vi.fn(() => outgoing.emit('close'));
  request.mockImplementation((options, onResponse) => {
    respond = () => onResponse(incoming as unknown as IncomingMessage);
    started(options);
    return Object.assign(outgoing, { end, destroy });
  });
  return { opened, respond: () => respond(), incoming, outgoing, end, destroy };
}

function dial(options: RequestOptions, name: string, all = false) {
  return new Promise((resolve, reject) => {
    options.lookup!(name, { family: options.family, all }, (error, address, family) => {
      if (error) reject(error);
      else resolve(all ? address : { address, family });
    });
  });
}

describe('public HTTPS policy', () => {
  it.each([
    'http://provider.example', 'https://user:password@provider.example', 'https://provider.example:0',
    'https://0x7f000001', 'https://[::ffff:169.254.169.254]',
  ])('rejects %s before DNS or HTTPS', async url => {
    await expect(send(url)).rejects.toMatchObject({ status: 400 });
    expect(lookup).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    '0.0.0.0', '127.0.0.2', '10.2.3.4', '172.31.255.254', '192.168.0.1', '100.100.100.200',
    '169.254.169.254', '168.63.129.16', '192.0.0.192', '192.0.2.1', '198.18.0.1', '198.51.100.1',
    '203.0.113.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '::', '::1', 'fd00:ec2::254', 'fc00::1', 'fe80::1', 'fec0::1', 'ff02::1',
    '::ffff:a00:1', '::ffff:8.8.8.8', '::8.8.8.8', '64:ff9b::a9fe:a9fe', '100::1',
    '2001::1', '2001:db8::1', '2002::1', '3fff::1', '4000::1', '2606:4700::1111%en0',
  ])('rejects DNS record %s even alongside a public record', async address => {
    lookup.mockResolvedValue([publicV4, { address, family: address.includes(':') ? 6 : 4 }]);
    await expect(send()).rejects.toMatchObject({ status: 400 });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([[], [{ address: 'not-an-ip', family: 4 }], [{ address: '8.8.8.8', family: 6 }]])(
    'rejects empty or invalid DNS results (%j)', async (...records) => {
      lookup.mockResolvedValue(records);
      await expect(send()).rejects.toMatchObject({ status: 400 });
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each([publicV4, publicV6])('pins $address without changing TLS or HTTP identity', async pinned => {
    lookup.mockResolvedValue([pinned, pinned === publicV4 ? publicV6 : publicV4]);
    const socket = wire();
    const result = send(endpoint, undefined, { Host: 'wrong.example', 'Proxy-Authorization': 'ignored',
      Connection: 'upgrade', 'Transfer-Encoding': 'chunked', 'Content-Length': '1', 'Accept-Encoding': 'gzip' });
    const options = await socket.opened;
    expect(lookup.mock.calls).toEqual([['provider.example', { all: true }]]);
    // The connect-time lookup must still hand Node the pinned result if DNS has since changed.
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(dial(options, 'provider.example')).resolves.toEqual(pinned);
    await expect(dial(options, 'provider.example', true)).resolves.toEqual([pinned]);
    await expect(dial(options, 'wrong.example')).rejects.toBeInstanceOf(HttpError);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(options).toMatchObject({ hostname: 'provider.example', servername: 'provider.example', port: '8443',
      path: '/v1/chat?mode=stream', method: 'POST', family: pinned.family, agent: false, rejectUnauthorized: true });
    expect(options.checkServerIdentity).toBeUndefined();
    expect(options.headers).toEqual({ authorization: headers.Authorization, 'content-type': headers['Content-Type'],
      'content-length': String(Buffer.byteLength(body)), 'accept-encoding': 'identity' });
    expect(socket.end.mock.calls).toEqual([[body]]);
    socket.respond();
    const response = await result;
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    socket.incoming.write('data: first\n\n');
    expect(await reader.read()).toEqual({ done: false, value: Buffer.from('data: first\n\n') });
    socket.incoming.end('data: last\n\n');
    expect((await reader.read()).value).toEqual(Buffer.from('data: last\n\n'));
    expect((await reader.read()).done).toBe(true);
  });

  it.each(['8.8.8.8', '[2606:4700::1111]'])('handles validated IP literal %s without DNS or SNI', async host => {
    const socket = wire(204);
    const result = send(`https://${host}/`);
    expect(await socket.opened).toMatchObject({ hostname: host.replace(/^\[|\]$/g, ''), servername: '', rejectUnauthorized: true });
    expect(lookup).not.toHaveBeenCalled();
    socket.respond();
    expect(await result).toMatchObject({ status: 204, body: null });
    expect(socket.incoming.destroyed).toBe(true);
  });

  it('rejects redirects and closes the response without a second request', async () => {
    const socket = wire(307, { location: 'https://other.example/' });
    const result = send();
    await socket.opened;
    socket.respond();
    await expect(result).rejects.toMatchObject({ status: 502 });
    expect(socket.incoming.destroyed).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});

describe('cancellation and failures', () => {
  it('does not start DNS for an already aborted signal', async () => {
    await expect(send(endpoint, AbortSignal.abort(body))).rejects.toMatchObject({ status: 502, message: expect.not.stringContaining(body) });
    expect(lookup).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('aborts during DNS without using a late result', async () => {
    let finish!: (records: LookupAddress[]) => void;
    lookup.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const result = send(endpoint, controller.signal);
    expect(lookup).toHaveBeenCalledTimes(1);
    controller.abort();
    await expect(result).rejects.toMatchObject({ status: 502 });
    finish([publicV4]);
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
  });

  it('aborts HTTPS after upload finishes but before headers and disables further lookups', async () => {
    const socket = wire();
    const controller = new AbortController();
    const result = send(endpoint, controller.signal);
    const options = await socket.opened;
    socket.outgoing.emit('finish');
    controller.abort();
    await expect(result).rejects.toMatchObject({ status: 502 });
    expect(socket.destroy).toHaveBeenCalledTimes(1);
    await expect(dial(options, 'provider.example')).rejects.toBeInstanceOf(HttpError);
  });

  it('rejects when HTTPS closes without response headers', async () => {
    const socket = wire();
    const result = send();
    await socket.opened;
    socket.outgoing.emit('close');
    await expect(result).rejects.toMatchObject({ status: 502 });
  });

  it('aborts a pending response read', async () => {
    const socket = wire();
    const controller = new AbortController();
    const result = send(endpoint, controller.signal);
    await socket.opened;
    socket.respond();
    const read = (await result).body!.getReader().read();
    await Promise.resolve();
    controller.abort();
    await expect(read).rejects.toMatchObject({ status: 502 });
    expect(socket.incoming.destroyed).toBe(true);
  });

  it('destroys the upstream when the bounded reader cancels', async () => {
    const socket = wire();
    const result = send();
    await socket.opened;
    socket.respond();
    await (await result).body!.cancel();
    expect(socket.incoming.destroyed).toBe(true);
  });

  it('sanitizes DNS, HTTPS and response stream errors', async () => {
    const sensitiveError = new Error(`${headers.Authorization} ${body}`);
    const safe = { status: 502, message: expect.not.stringMatching(/mock-key|mock 图/) };
    lookup.mockRejectedValueOnce(sensitiveError);
    await expect(send()).rejects.toMatchObject(safe);
    expect(request).not.toHaveBeenCalled();

    const socket = wire();
    const result = send();
    await socket.opened;
    socket.outgoing.emit('error', sensitiveError);
    await expect(result).rejects.toMatchObject(safe);

    const streaming = wire();
    const started = send();
    await streaming.opened;
    streaming.respond();
    const response = await started;
    streaming.incoming.destroy(sensitiveError);
    await expect(response.text()).rejects.toMatchObject(safe);
  });
});
