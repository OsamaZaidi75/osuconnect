import { parseInputEvent, type InputEvent } from '../../../electron/remote-control';

export type { InputEvent };

/** LiveKit data-channel topic for remote-control traffic. */
export const REMOTE_CONTROL_TOPIC = 'rc';

const PROTOCOL_VERSION = 1;

/** Why a request wasn't granted. */
export type DenyReason = 'denied' | 'busy' | 'unavailable';

/** Why control ended. */
export type RevokeReason = 'sharer' | 'stopped';

/**
 * Remote-control messages. Viewer → sharer: query, request, cancel, release,
 * input. Sharer → viewer(s): status, granted, denied, revoked.
 */
export type RemoteControlMessage =
  | { t: 'query' }
  | { t: 'request' }
  | { t: 'cancel' }
  | { t: 'release' }
  | { t: 'input'; e: InputEvent }
  | { t: 'status'; available: boolean; controller: string | null }
  | { t: 'granted' }
  | { t: 'denied'; reason: DenyReason }
  | { t: 'revoked'; reason: RevokeReason };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeMessage(message: RemoteControlMessage): Uint8Array {
  return encoder.encode(JSON.stringify({ v: PROTOCOL_VERSION, ...message }));
}

const DENY_REASONS: readonly string[] = ['denied', 'busy', 'unavailable'];
const REVOKE_REASONS: readonly string[] = ['sharer', 'stopped'];

/** Decode and validate a message from the network; null when it isn't a valid one. */
export function parseMessage(payload: Uint8Array): RemoteControlMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(decoder.decode(payload));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const message = raw as Record<string, unknown>;
  if (message.v !== PROTOCOL_VERSION) return null;

  switch (message.t) {
    case 'query':
    case 'request':
    case 'cancel':
    case 'release':
    case 'granted':
      return { t: message.t };
    case 'input': {
      const event = parseInputEvent(message.e);
      return event ? { t: 'input', e: event } : null;
    }
    case 'status': {
      if (typeof message.available !== 'boolean') return null;
      const controller = message.controller;
      if (controller !== null && (typeof controller !== 'string' || controller.length > 128)) return null;
      return { t: 'status', available: message.available, controller };
    }
    case 'denied':
      return typeof message.reason === 'string' && DENY_REASONS.includes(message.reason)
        ? { t: 'denied', reason: message.reason as DenyReason }
        : null;
    case 'revoked':
      return typeof message.reason === 'string' && REVOKE_REASONS.includes(message.reason)
        ? { t: 'revoked', reason: message.reason as RevokeReason }
        : null;
    default:
      return null;
  }
}

/** Mouse moves and wheel ticks may be dropped under load; everything else must arrive. */
export function isLossy(message: RemoteControlMessage): boolean {
  return message.t === 'input' && (message.e.k === 'move' || message.e.k === 'wheel');
}

/**
 * Where a pointer is on the shared screen, as 0..1 fractions of it, given the
 * element showing the video (`object-fit: contain`, so it may be letterboxed).
 * Null when the pointer is over the black bars or the video size is unknown.
 */
export function normalizePointer(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  video: { width: number; height: number },
): { x: number; y: number } | null {
  if (video.width <= 0 || video.height <= 0 || rect.width <= 0 || rect.height <= 0) return null;

  const scale = Math.min(rect.width / video.width, rect.height / video.height);
  const contentWidth = video.width * scale;
  const contentHeight = video.height * scale;
  const x = (clientX - rect.left - (rect.width - contentWidth) / 2) / contentWidth;
  const y = (clientY - rect.top - (rect.height - contentHeight) / 2) / contentHeight;

  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}
