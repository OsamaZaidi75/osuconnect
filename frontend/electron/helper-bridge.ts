/**
 * Remote-control helper: the loopback HTTP bridge.
 *
 * Browsers can't inject input, so a person sharing their screen from a browser
 * runs the desktop app in helper mode (`--helper`). The OsuConnect web page
 * talks to it over 127.0.0.1 with the same operations the desktop app's
 * preload bridge offers. The approval dialog stays native (main.ts), so the
 * page can't grant itself control.
 *
 * Pure Node (no Electron import) so it is unit-tested directly. Anything that
 * isn't the OsuConnect page is refused: the Origin must be on the allowlist
 * (a random website can reach 127.0.0.1 too), the Host must be loopback
 * (DNS rebinding), and every call needs a JSON content type, which forces a
 * CORS preflight from other origins.
 */

import * as http from 'http';
import type { AddressInfo } from 'net';

export type HelperAvailability =
  | { supported: true }
  | { supported: false; reason: 'wayland' | 'driver' | 'permission' | 'no-screen' };

export type HelperRequestResult = 'granted' | 'denied' | 'busy' | 'unavailable';

/** What the page knows about the screen it is sharing (from the track's settings). */
export interface ShareInfo {
  /** `displaySurface`: 'monitor' for an entire screen. */
  surface: string;
  width: number;
  height: number;
}

export interface HelperBackend {
  setShare(info: ShareInfo | null): void;
  availability(): Promise<HelperAvailability>;
  request(controllerId: string, name: string): Promise<HelperRequestResult>;
  input(events: unknown[]): void;
  end(): void;
}

/** Instances this build of the helper trusts out of the box. */
export const DEFAULT_ALLOWED_ORIGINS = [
  'https://129-80-41-146.nip.io',
  'https://chat.osuconnect.xo.je',
];

const MAX_BODY_BYTES = 64 * 1024;
const MAX_EVENTS_PER_BATCH = 200;
const KEEPALIVE_MS = 15_000;

/** Comma-separated origins (e.g. from OSUCONNECT_HELPER_ORIGINS) to normalised origins; junk is dropped. */
export function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  const origins: string[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      const url = new URL(trimmed);
      if (url.protocol === 'https:' || url.protocol === 'http:') origins.push(url.origin);
    } catch {
      // not a URL
    }
  }
  return origins;
}

/** undefined: invalid. null: the share ended. */
export function parseShareInfo(raw: unknown): ShareInfo | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const { surface, width, height } = raw as Record<string, unknown>;
  if (surface === null) return null;
  if (typeof surface !== 'string' || surface.length > 32) return undefined;
  if (typeof width !== 'number' || typeof height !== 'number') return undefined;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  return { surface, width, height };
}

export interface DisplayInfo {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  primary: boolean;
}

/**
 * Which display a browser is sharing. Browsers don't say, so match the shared
 * video's aspect ratio against each display; when several match (identical
 * monitors), prefer the one the pointer is on, then the primary.
 */
export function chooseDisplay(
  displays: DisplayInfo[],
  share: { width: number; height: number },
  cursor: { x: number; y: number },
): DisplayInfo | null {
  if (displays.length === 0) return null;
  if (displays.length === 1) return displays[0];

  const aspect = share.width / share.height;
  const distance = (display: DisplayInfo) =>
    Math.abs(Math.log(display.bounds.width / display.bounds.height / aspect));
  const best = Math.min(...displays.map(distance));
  const candidates = displays.filter((display) => distance(display) - best < 0.02);
  if (candidates.length === 1) return candidates[0];

  const underCursor = candidates.find(
    ({ bounds }) =>
      cursor.x >= bounds.x &&
      cursor.x < bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y < bounds.y + bounds.height,
  );
  return underCursor ?? candidates.find((display) => display.primary) ?? candidates[0];
}

export interface HelperBridge {
  /** Resolves with the port actually bound. */
  listen(): Promise<number>;
  close(): Promise<void>;
  /** Tell every page listening that control ended without it asking. */
  broadcastStopped(reason: string): void;
}

export function createBridge(options: {
  port: number;
  allowedOrigins: string[];
  backend: HelperBackend;
}): HelperBridge {
  const { backend } = options;
  const allowed = new Set(options.allowedOrigins);
  const streams = new Set<http.ServerResponse>();

  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const readJson = (req: http.IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false }> =>
    new Promise((resolve) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          resolve({ ok: false });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          resolve({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch {
          resolve({ ok: false });
        }
      });
      req.on('error', () => resolve({ ok: false }));
    });

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const port = (server.address() as AddressInfo).port;
    const host = req.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return send(res, 403, { error: 'bad host' });
    }

    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !allowed.has(origin)) {
      return send(res, 403, { error: 'origin not allowed' });
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    // Chrome asks permission to reach loopback from a public page
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
      res.writeHead(204);
      res.end();
      return;
    }

    const path = (req.url ?? '').split('?')[0];

    if (req.method === 'GET') {
      switch (path) {
        case '/rc/ping':
          return send(res, 200, { ok: true, name: 'osuconnect-helper', v: 1 });
        case '/rc/availability':
          return send(res, 200, await backend.availability());
        case '/rc/events': {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          res.write(': connected\n\n');
          streams.add(res);
          const timer = setInterval(() => res.write(': keepalive\n\n'), KEEPALIVE_MS);
          res.on('close', () => {
            clearInterval(timer);
            streams.delete(res);
          });
          return;
        }
        default:
          return send(res, 404, { error: 'not found' });
      }
    }

    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
      return send(res, 415, { error: 'JSON only' });
    }
    const body = await readJson(req);
    if (!body.ok) return send(res, 400, { error: 'bad body' });
    const value = body.value;

    switch (path) {
      case '/rc/share': {
        const info = parseShareInfo(value);
        if (info === undefined) return send(res, 400, { error: 'bad share info' });
        backend.setShare(info);
        return send(res, 200, { ok: true });
      }
      case '/rc/request': {
        const { controllerId, name } = (value ?? {}) as Record<string, unknown>;
        if (typeof controllerId !== 'string' || controllerId.length === 0 || controllerId.length > 128) {
          return send(res, 400, { error: 'bad controller' });
        }
        const result = await backend.request(controllerId, typeof name === 'string' ? name : '');
        return send(res, 200, { result });
      }
      case '/rc/input': {
        if (!Array.isArray(value) || value.length > MAX_EVENTS_PER_BATCH) {
          return send(res, 400, { error: 'bad batch' });
        }
        backend.input(value);
        return send(res, 200, { ok: true });
      }
      case '/rc/end':
        backend.end();
        return send(res, 200, { ok: true });
      default:
        return send(res, 404, { error: 'not found' });
    }
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
      else res.end();
    });
  });

  return {
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve((server.address() as AddressInfo).port);
        });
      }),
    close: () =>
      new Promise((resolve) => {
        for (const stream of streams) stream.end();
        streams.clear();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
    broadcastStopped: (reason) => {
      for (const stream of streams) stream.write(`event: stopped\ndata: ${JSON.stringify(reason)}\n\n`);
    },
  };
}
