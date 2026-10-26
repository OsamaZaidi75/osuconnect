import { HELPER_URL } from '../../../electron/remote-control';
import type { RemoteControlHostApi } from './useRemoteControlHost';
import type { RemoteControlAvailability, RemoteControlRequestResult } from '../../types/electron-api';
import { logger } from '../../utils/logger';

/** What the page knows about the screen it's sharing, from the capture track's settings. */
export interface ShareInfo {
  surface: string;
  width: number;
  height: number;
}

const PROBE_TIMEOUT_MS = 1500;
/** Longer than the helper's own approval timeout, so its answer always arrives first. */
const REQUEST_TIMEOUT_MS = 45_000;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** Is the remote-control helper running on this computer? */
export async function probeHelper(baseUrl: string = HELPER_URL): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/rc/ping`, {
      signal: timeoutSignal(PROBE_TIMEOUT_MS),
      credentials: 'omit',
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { name?: unknown };
    return body.name === 'osuconnect-helper';
  } catch {
    return false;
  }
}

/** The shared screen as the browser reports it; null when no entire-screen share is live. */
export function readShareInfo(track: MediaStreamTrack | null | undefined): ShareInfo | null {
  if (!track) return null;
  const { displaySurface, width, height } = track.getSettings() as MediaTrackSettings & {
    displaySurface?: string;
  };
  if (typeof displaySurface !== 'string' || !width || !height) return null;
  return { surface: displaySurface, width, height };
}

export type HelperApi = RemoteControlHostApi & { dispose: () => void };

/**
 * The same operations the desktop app's preload bridge offers, over the
 * helper's loopback HTTP API. Input is sent in order, one batch in flight at a
 * time, so a click's down and up can never swap.
 */
export function createHelperApi(
  getShareInfo: () => ShareInfo | null,
  baseUrl: string = HELPER_URL,
): HelperApi {
  let disposed = false;
  const stoppedListeners = new Set<(reason: string) => void>();
  let events: EventSource | null = null;

  const post = (path: string, body: unknown, timeoutMs = 5000) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
      credentials: 'omit',
      signal: timeoutSignal(timeoutMs),
    });

  const ensureEvents = () => {
    if (events || disposed) return;
    events = new EventSource(`${baseUrl}/rc/events`);
    events.addEventListener('stopped', (event) => {
      let reason = 'main';
      try {
        reason = String(JSON.parse((event as MessageEvent<string>).data));
      } catch {
        // keep the default
      }
      stoppedListeners.forEach((listener) => listener(reason));
    });
  };

  let queue: unknown[] = [];
  let flushing = false;
  const flush = async () => {
    if (flushing) return;
    flushing = true;
    try {
      while (queue.length > 0 && !disposed) {
        const batch = queue.splice(0, 100);
        await post('/rc/input', batch).catch((error: unknown) =>
          logger.debug('[remote-control] helper input failed', error),
        );
      }
    } finally {
      flushing = false;
    }
  };

  return {
    async getRemoteControlAvailability(): Promise<RemoteControlAvailability> {
      try {
        await post('/rc/share', getShareInfo());
        const response = await fetch(`${baseUrl}/rc/availability`, {
          credentials: 'omit',
          signal: timeoutSignal(5000),
        });
        return (await response.json()) as RemoteControlAvailability;
      } catch {
        return { supported: false, reason: 'driver' };
      }
    },

    async requestRemoteControl(controllerId: string, controllerName: string): Promise<RemoteControlRequestResult> {
      try {
        const response = await post('/rc/request', { controllerId, name: controllerName }, REQUEST_TIMEOUT_MS);
        const body = (await response.json()) as { result?: RemoteControlRequestResult };
        return body.result ?? 'unavailable';
      } catch {
        return 'unavailable';
      }
    },

    sendRemoteControlInput(event: unknown) {
      queue.push(event);
      void flush();
    },

    endRemoteControl() {
      queue = [];
      post('/rc/end', {}).catch(() => undefined);
    },

    notifyRemoteControlShareStopped() {
      post('/rc/share', null).catch(() => undefined);
    },

    onRemoteControlStopped(callback: (reason: string) => void) {
      stoppedListeners.add(callback);
      ensureEvents();
      return () => {
        stoppedListeners.delete(callback);
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      queue = [];
      events?.close();
      events = null;
      stoppedListeners.clear();
      post('/rc/end', {}).catch(() => undefined);
      post('/rc/share', null).catch(() => undefined);
    },
  };
}
