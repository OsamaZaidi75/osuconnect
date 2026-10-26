import { describe, it, expect } from 'vitest';
import {
  encodeMessage,
  parseMessage,
  isLossy,
  normalizePointer,
  type RemoteControlMessage,
} from '../../features/remoteControl/protocol';

const roundTrip = (message: RemoteControlMessage) => parseMessage(encodeMessage(message));
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('remote control protocol', () => {
  it.each<RemoteControlMessage>([
    { t: 'query' },
    { t: 'request' },
    { t: 'cancel' },
    { t: 'release' },
    { t: 'granted' },
    { t: 'status', available: true, controller: 'alice' },
    { t: 'status', available: false, controller: null },
    { t: 'denied', reason: 'busy' },
    { t: 'revoked', reason: 'sharer' },
    { t: 'input', e: { k: 'move', x: 0.5, y: 0.25 } },
    { t: 'input', e: { k: 'key', down: true, code: 'KeyA' } },
  ])('round-trips %j', (message) => {
    expect(roundTrip(message)).toEqual(message);
  });

  it('sanitises input events', () => {
    expect(parseMessage(bytes({ v: 1, t: 'input', e: { k: 'move', x: 5, y: -5 } }))).toEqual({
      t: 'input',
      e: { k: 'move', x: 1, y: 0 },
    });
  });

  it.each([
    ['not JSON', new TextEncoder().encode('{nope')],
    ['wrong version', bytes({ v: 2, t: 'query' })],
    ['no version', bytes({ t: 'query' })],
    ['unknown type', bytes({ v: 1, t: 'exec' })],
    ['array', bytes([])],
    ['bad input event', bytes({ v: 1, t: 'input', e: { k: 'key', down: true, code: 'Nope' } })],
    ['input without event', bytes({ v: 1, t: 'input' })],
    ['status without flag', bytes({ v: 1, t: 'status', controller: null })],
    ['status with long controller', bytes({ v: 1, t: 'status', available: true, controller: 'x'.repeat(200) })],
    ['bad deny reason', bytes({ v: 1, t: 'denied', reason: 'because' })],
    ['bad revoke reason', bytes({ v: 1, t: 'revoked', reason: 'because' })],
  ])('rejects %s', (_label, payload) => {
    expect(parseMessage(payload)).toBeNull();
  });

  it('treats only moves and wheel ticks as lossy', () => {
    expect(isLossy({ t: 'input', e: { k: 'move', x: 0, y: 0 } })).toBe(true);
    expect(isLossy({ t: 'input', e: { k: 'wheel', dx: 0, dy: 1 } })).toBe(true);
    expect(isLossy({ t: 'input', e: { k: 'down', b: 'left', x: 0, y: 0 } })).toBe(false);
    expect(isLossy({ t: 'input', e: { k: 'key', down: false, code: 'KeyA' } })).toBe(false);
    expect(isLossy({ t: 'request' })).toBe(false);
  });
});

describe('normalizePointer', () => {
  const rect = { left: 10, top: 20, width: 800, height: 600 };

  it('maps a pointer over a video that fills the element', () => {
    expect(normalizePointer(410, 320, rect, { width: 1600, height: 1200 })).toEqual({ x: 0.5, y: 0.5 });
  });

  it('accounts for the black bars of a wide video in a taller element', () => {
    // 1600x600 video in 800x600: scaled to 800x300, centred, 150px bars top and bottom
    expect(normalizePointer(410, 320, rect, { width: 1600, height: 600 })).toEqual({ x: 0.5, y: 0.5 });
    expect(normalizePointer(410, 100, rect, { width: 1600, height: 600 })).toBeNull();
  });

  it('accounts for the bars of a tall video in a wider element', () => {
    // 400x600 video in 800x600: scaled to 400x600, centred, 200px bars left and right
    expect(normalizePointer(210, 320, rect, { width: 400, height: 600 })).toEqual({ x: 0, y: 0.5 });
    expect(normalizePointer(100, 320, rect, { width: 400, height: 600 })).toBeNull();
  });

  it('is null when sizes are unknown', () => {
    expect(normalizePointer(0, 0, rect, { width: 0, height: 0 })).toBeNull();
    expect(normalizePointer(0, 0, { ...rect, width: 0 }, { width: 10, height: 10 })).toBeNull();
  });
});
