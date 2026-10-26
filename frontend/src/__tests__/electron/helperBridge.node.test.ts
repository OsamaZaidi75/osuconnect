// @vitest-environment node
/**
 * Remote-control helper, loopback bridge: who may talk to it and what each
 * call does. Real HTTP against a listener on an ephemeral port.
 */
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chooseDisplay,
  createBridge,
  parseOrigins,
  parseShareInfo,
  type DisplayInfo,
  type HelperBackend,
  type HelperBridge,
} from '../../../electron/helper-bridge';

const ORIGIN = 'https://chat.example';

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function call(
  port: number,
  options: { method?: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: options.method ?? 'GET',
        path: options.path,
        headers: { Host: `127.0.0.1:${port}`, ...options.headers },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

describe('helper bridge', () => {
  let bridge: HelperBridge;
  let port: number;
  let backend: { [K in keyof HelperBackend]: ReturnType<typeof vi.fn> };

  const asPage = (extra: Record<string, string> = {}) => ({ Origin: ORIGIN, ...extra });
  const post = (path: string, body: unknown, headers: Record<string, string> = asPage()) =>
    call(port, {
      method: 'POST',
      path,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  beforeEach(async () => {
    backend = {
      setShare: vi.fn(),
      availability: vi.fn().mockResolvedValue({ supported: true }),
      request: vi.fn().mockResolvedValue('granted'),
      input: vi.fn(),
      end: vi.fn(),
    };
    bridge = createBridge({ port: 0, allowedOrigins: [ORIGIN], backend: backend as unknown as HelperBackend });
    port = await bridge.listen();
  });

  afterEach(async () => {
    await bridge.close();
  });

  describe('who may talk to it', () => {
    it('answers the OsuConnect page, with CORS and the private-network header', async () => {
      const reply = await call(port, { path: '/rc/ping', headers: asPage() });

      expect(reply.status).toBe(200);
      expect(JSON.parse(reply.body)).toMatchObject({ ok: true, name: 'osuconnect-helper' });
      expect(reply.headers['access-control-allow-origin']).toBe(ORIGIN);
      expect(reply.headers['access-control-allow-private-network']).toBe('true');
      expect(reply.headers.vary).toBe('Origin');
    });

    it('refuses a website that is not on the allowlist, with no CORS headers', async () => {
      const reply = await call(port, { path: '/rc/ping', headers: { Origin: 'https://evil.example' } });

      expect(reply.status).toBe(403);
      expect(reply.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('refuses requests with no Origin (a local program, not the page)', async () => {
      expect((await call(port, { path: '/rc/ping' })).status).toBe(403);
    });

    it('refuses a non-loopback Host (DNS rebinding)', async () => {
      const reply = await call(port, {
        path: '/rc/ping',
        headers: asPage({ Host: `rebind.example:${port}` }),
      });
      expect(reply.status).toBe(403);
    });

    it('accepts localhost as the Host', async () => {
      const reply = await call(port, { path: '/rc/ping', headers: asPage({ Host: `localhost:${port}` }) });
      expect(reply.status).toBe(200);
    });

    it('does not reach the backend for refused requests', async () => {
      await post('/rc/input', [{ k: 'move' }], { Origin: 'https://evil.example' });
      await call(port, { method: 'POST', path: '/rc/end', headers: { 'Content-Type': 'application/json' }, body: '{}' });

      expect(backend.input).not.toHaveBeenCalled();
      expect(backend.end).not.toHaveBeenCalled();
    });

    it('answers the CORS preflight for an allowed origin', async () => {
      const reply = await call(port, {
        method: 'OPTIONS',
        path: '/rc/request',
        headers: asPage({ 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Private-Network': 'true' }),
      });

      expect(reply.status).toBe(204);
      expect(reply.headers['access-control-allow-methods']).toContain('POST');
      expect(reply.headers['access-control-allow-headers']).toContain('Content-Type');
      expect(reply.headers['access-control-allow-private-network']).toBe('true');
    });

    it('refuses the preflight for another origin', async () => {
      const reply = await call(port, { method: 'OPTIONS', path: '/rc/request', headers: { Origin: 'https://evil.example' } });
      expect(reply.status).toBe(403);
    });
  });

  describe('operations', () => {
    it('reports availability', async () => {
      backend.availability.mockResolvedValue({ supported: false, reason: 'wayland' });

      const reply = await call(port, { path: '/rc/availability', headers: asPage() });

      expect(JSON.parse(reply.body)).toEqual({ supported: false, reason: 'wayland' });
    });

    it('records the shared screen and its end', async () => {
      expect((await post('/rc/share', { surface: 'monitor', width: 1920, height: 1080 })).status).toBe(200);
      expect((await post('/rc/share', { surface: null })).status).toBe(200);

      expect(backend.setShare).toHaveBeenNthCalledWith(1, { surface: 'monitor', width: 1920, height: 1080 });
      expect(backend.setShare).toHaveBeenNthCalledWith(2, null);
    });

    it('rejects malformed share info', async () => {
      expect((await post('/rc/share', { surface: 'monitor', width: 'wide', height: 1 })).status).toBe(400);
      expect(backend.setShare).not.toHaveBeenCalled();
    });

    it('relays a control request and its answer', async () => {
      backend.request.mockResolvedValue('denied');

      const reply = await post('/rc/request', { controllerId: 'alice', name: 'Alice' });

      expect(JSON.parse(reply.body)).toEqual({ result: 'denied' });
      expect(backend.request).toHaveBeenCalledWith('alice', 'Alice');
    });

    it('rejects a request without a controller id', async () => {
      expect((await post('/rc/request', { name: 'Alice' })).status).toBe(400);
      expect((await post('/rc/request', { controllerId: '' })).status).toBe(400);
      expect(backend.request).not.toHaveBeenCalled();
    });

    it('passes input batches through in order', async () => {
      const events = [
        { k: 'down', b: 'left', x: 0.5, y: 0.5 },
        { k: 'up', b: 'left', x: 0.5, y: 0.5 },
      ];

      expect((await post('/rc/input', events)).status).toBe(200);

      expect(backend.input).toHaveBeenCalledWith(events);
    });

    it('rejects a batch that is not an array or is too big', async () => {
      expect((await post('/rc/input', { k: 'move' })).status).toBe(400);
      expect((await post('/rc/input', Array.from({ length: 201 }, () => ({ k: 'move' })))).status).toBe(400);
      expect(backend.input).not.toHaveBeenCalled();
    });

    it('ends control on request', async () => {
      expect((await post('/rc/end', {})).status).toBe(200);
      expect(backend.end).toHaveBeenCalledTimes(1);
    });

    it('requires a JSON content type on POST', async () => {
      const reply = await call(port, {
        method: 'POST',
        path: '/rc/end',
        headers: { ...asPage(), 'Content-Type': 'text/plain' },
        body: '{}',
      });
      expect(reply.status).toBe(415);
      expect(backend.end).not.toHaveBeenCalled();
    });

    it('rejects invalid JSON and oversized bodies', async () => {
      const invalid = await call(port, {
        method: 'POST',
        path: '/rc/end',
        headers: { ...asPage(), 'Content-Type': 'application/json' },
        body: '{nope',
      });
      expect(invalid.status).toBe(400);

      const big = await call(port, {
        method: 'POST',
        path: '/rc/input',
        headers: { ...asPage(), 'Content-Type': 'application/json' },
        body: JSON.stringify(['x'.repeat(70 * 1024)]),
      }).catch(() => ({ status: 0 }));
      expect([0, 400]).toContain(big.status);
      expect(backend.input).not.toHaveBeenCalled();
    });

    it('404s unknown paths and 405s other methods', async () => {
      expect((await call(port, { path: '/nope', headers: asPage() })).status).toBe(404);
      expect((await call(port, { method: 'DELETE', path: '/rc/end', headers: asPage() })).status).toBe(405);
    });

    it('turns a backend failure into a 500 instead of crashing', async () => {
      backend.availability.mockRejectedValue(new Error('driver exploded'));
      expect((await call(port, { path: '/rc/availability', headers: asPage() })).status).toBe(500);
    });
  });

  describe('events', () => {
    it('streams "stopped" to listening pages', async () => {
      const received = await new Promise<string>((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port, path: '/rc/events', headers: { Host: `127.0.0.1:${port}`, Origin: ORIGIN } },
          (res) => {
            expect(res.headers['content-type']).toBe('text/event-stream');
            let text = '';
            res.on('data', (chunk) => {
              text += chunk;
              if (text.includes('event: stopped')) {
                resolve(text);
                req.destroy();
              } else if (text.includes(': connected')) {
                bridge.broadcastStopped('shortcut');
              }
            });
          },
        );
        req.on('error', (error) => {
          if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
        });
        req.end();
      });

      expect(received).toContain('event: stopped\ndata: "shortcut"');
    });

    it('does nothing when nobody is listening', () => {
      expect(() => bridge.broadcastStopped('shortcut')).not.toThrow();
    });
  });
});

describe('parseOrigins', () => {
  it('normalises, drops junk and non-web schemes', () => {
    expect(parseOrigins('https://a.example/path, http://b.example:8080 ,nonsense,ftp://c.example,')).toEqual([
      'https://a.example',
      'http://b.example:8080',
    ]);
    expect(parseOrigins(undefined)).toEqual([]);
    expect(parseOrigins('')).toEqual([]);
  });
});

describe('parseShareInfo', () => {
  it('accepts a share, and null for "ended"', () => {
    expect(parseShareInfo({ surface: 'monitor', width: 1920, height: 1080 })).toEqual({
      surface: 'monitor',
      width: 1920,
      height: 1080,
    });
    expect(parseShareInfo(null)).toBeNull();
    expect(parseShareInfo({ surface: null })).toBeNull();
  });

  it.each([undefined, 3, 'monitor', [], {}, { surface: 'monitor' }, { surface: 'monitor', width: 0, height: 5 }, { surface: 'monitor', width: NaN, height: 5 }, { surface: 5, width: 1, height: 1 }])(
    'rejects %j',
    (raw) => {
      expect(parseShareInfo(raw)).toBeUndefined();
    },
  );
});

describe('chooseDisplay', () => {
  const display = (id: number, x: number, w: number, h: number, primary = false): DisplayInfo => ({
    id,
    bounds: { x, y: 0, width: w, height: h },
    primary,
  });

  it('returns null with no displays and the only display otherwise', () => {
    expect(chooseDisplay([], { width: 1, height: 1 }, { x: 0, y: 0 })).toBeNull();
    const only = display(1, 0, 1920, 1080, true);
    expect(chooseDisplay([only], { width: 1280, height: 720 }, { x: 0, y: 0 })).toBe(only);
  });

  it('picks the display with the matching aspect ratio', () => {
    const wide = display(1, 0, 2560, 1080, true);
    const tv = display(2, 2560, 1920, 1080);
    const portrait = display(3, 4480, 1080, 1920);
    const displays = [wide, tv, portrait];

    expect(chooseDisplay(displays, { width: 1080, height: 1920 }, { x: 0, y: 0 })).toBe(portrait);
    expect(chooseDisplay(displays, { width: 1280, height: 720 }, { x: 0, y: 0 })).toBe(tv);
    expect(chooseDisplay(displays, { width: 2560, height: 1080 }, { x: 3000, y: 0 })).toBe(wide);
  });

  it('breaks a tie between identical monitors with the pointer, then the primary', () => {
    const left = display(1, 0, 1920, 1080, true);
    const right = display(2, 1920, 1920, 1080);
    const share = { width: 1920, height: 1080 };

    expect(chooseDisplay([left, right], share, { x: 2500, y: 400 })).toBe(right);
    expect(chooseDisplay([left, right], share, { x: 100, y: 400 })).toBe(left);
    expect(chooseDisplay([left, right], share, { x: -50, y: 400 })).toBe(left);
  });
});
