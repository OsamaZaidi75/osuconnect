import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RemoteControlSession,
  domCodeToKey,
  mapNormalizedPoint,
  parseInputEvent,
  wheelToTicks,
  MAX_EVENTS_PER_SECOND,
  type Bounds,
  type InputDriver,
} from '../../../electron/remote-control';

const BOUNDS: Bounds = { x: 100, y: 50, width: 1921, height: 1081 };

function createDriver() {
  return {
    moveMouse: vi.fn(),
    dragMouse: vi.fn(),
    mouseToggle: vi.fn(),
    scrollMouse: vi.fn(),
    keyToggle: vi.fn(),
  } satisfies InputDriver;
}

describe('domCodeToKey', () => {
  it.each([
    ['KeyA', 'a'],
    ['KeyZ', 'z'],
    ['Digit0', '0'],
    ['Digit9', '9'],
    ['Numpad5', 'numpad_5'],
    ['F1', 'f1'],
    ['F12', 'f12'],
    ['Enter', 'enter'],
    ['ArrowLeft', 'left'],
    ['ShiftLeft', 'shift'],
    ['MetaLeft', 'command'],
    ['Semicolon', ';'],
    ['Space', 'space'],
  ])('maps %s to %s', (code, key) => {
    expect(domCodeToKey(code)).toBe(key);
  });

  it.each(['', 'F13', 'F0', 'KeyAB', 'Key1', 'Unidentified', 'AudioVolumeUp', '__proto__', 'constructor'])(
    'rejects %j',
    (code) => {
      expect(domCodeToKey(code)).toBeNull();
    },
  );
});

describe('parseInputEvent', () => {
  it('accepts and clamps pointer moves', () => {
    expect(parseInputEvent({ k: 'move', x: 0.25, y: 0.75 })).toEqual({ k: 'move', x: 0.25, y: 0.75 });
    expect(parseInputEvent({ k: 'move', x: -5, y: 9 })).toEqual({ k: 'move', x: 0, y: 1 });
  });

  it('accepts button events and strips unknown fields', () => {
    expect(parseInputEvent({ k: 'down', b: 'right', x: 0.5, y: 0.5, evil: 'x' })).toEqual({
      k: 'down',
      b: 'right',
      x: 0.5,
      y: 0.5,
    });
  });

  it('caps and rounds wheel deltas', () => {
    expect(parseInputEvent({ k: 'wheel', dx: 0.4, dy: 99999 })).toEqual({ k: 'wheel', dx: 0, dy: 2000 });
  });

  it('accepts supported keys only', () => {
    expect(parseInputEvent({ k: 'key', down: true, code: 'KeyA' })).toEqual({ k: 'key', down: true, code: 'KeyA' });
    expect(parseInputEvent({ k: 'key', down: true, code: 'Bogus' })).toBeNull();
    expect(parseInputEvent({ k: 'key', down: 'yes', code: 'KeyA' })).toBeNull();
  });

  it.each([
    null,
    undefined,
    42,
    'move',
    [],
    {},
    { k: 'move', x: NaN, y: 0 },
    { k: 'move', x: Infinity, y: 0 },
    { k: 'move', x: '0.5', y: 0 },
    { k: 'down', b: 'back', x: 0, y: 0 },
    { k: 'down', x: 0, y: 0 },
    { k: 'wheel', dx: 0 },
    { k: 'exec', cmd: 'calc' },
  ])('rejects malformed input %j', (raw) => {
    expect(parseInputEvent(raw)).toBeNull();
  });
});

describe('mapNormalizedPoint', () => {
  it('maps the corners onto the display bounds', () => {
    expect(mapNormalizedPoint(0, 0, BOUNDS)).toEqual({ x: 100, y: 50 });
    expect(mapNormalizedPoint(1, 1, BOUNDS)).toEqual({ x: 2020, y: 1130 });
  });

  it('keeps out-of-range input inside the display', () => {
    expect(mapNormalizedPoint(-1, 2, BOUNDS)).toEqual({ x: 100, y: 1130 });
  });

  it('handles a one-pixel display', () => {
    expect(mapNormalizedPoint(0.5, 0.5, { x: 7, y: 9, width: 1, height: 1 })).toEqual({ x: 7, y: 9 });
  });
});

describe('wheelToTicks', () => {
  it('inverts vertical so DOM "scroll down" becomes a negative driver scroll', () => {
    expect(wheelToTicks(0, 100)).toEqual({ x: 0, y: -2 });
    expect(wheelToTicks(0, -100)).toEqual({ x: 0, y: 2 });
  });

  it('keeps horizontal direction and always scrolls at least one tick', () => {
    expect(wheelToTicks(1, 0)).toEqual({ x: 1, y: 0 });
    expect(wheelToTicks(-300, 0).x).toBe(-6);
  });

  it('caps the tick count', () => {
    expect(wheelToTicks(0, 2000).y).toBe(-10);
  });
});

describe('RemoteControlSession', () => {
  let driver: ReturnType<typeof createDriver>;
  let bounds: Bounds | null;
  let now: number;
  let session: RemoteControlSession;

  beforeEach(() => {
    driver = createDriver();
    bounds = BOUNDS;
    now = 1_000;
    session = new RemoteControlSession({ driver, getTargetBounds: () => bounds, now: () => now });
  });

  it('ignores input until a controller is approved', () => {
    expect(session.apply({ k: 'move', x: 0.5, y: 0.5 })).toBe(false);
    expect(driver.moveMouse).not.toHaveBeenCalled();
  });

  it('refuses to begin when no screen is being shared', () => {
    bounds = null;
    expect(session.begin('alice')).toBe(false);
    expect(session.isActive).toBe(false);
  });

  it('allows one controller at a time', () => {
    expect(session.begin('alice')).toBe(true);
    expect(session.begin('bob')).toBe(false);
    expect(session.begin('alice')).toBe(true);
    expect(session.controllerId).toBe('alice');
  });

  it('moves the pointer to the mapped position', () => {
    session.begin('alice');
    expect(session.apply({ k: 'move', x: 0.5, y: 0.5 })).toBe(true);
    expect(driver.moveMouse).toHaveBeenCalledWith(1060, 590);
  });

  it('clicks at the event position', () => {
    session.begin('alice');
    session.apply({ k: 'down', b: 'left', x: 0, y: 0 });
    session.apply({ k: 'up', b: 'left', x: 0, y: 0 });
    expect(driver.moveMouse).toHaveBeenCalledWith(100, 50);
    expect(driver.mouseToggle).toHaveBeenNthCalledWith(1, 'down', 'left');
    expect(driver.mouseToggle).toHaveBeenNthCalledWith(2, 'up', 'left');
  });

  it('drags while a button is held', () => {
    session.begin('alice');
    session.apply({ k: 'down', b: 'left', x: 0, y: 0 });
    session.apply({ k: 'move', x: 1, y: 1 });
    expect(driver.dragMouse).toHaveBeenCalledWith(2020, 1130);
    session.apply({ k: 'up', b: 'left', x: 1, y: 1 });
    session.apply({ k: 'move', x: 0, y: 0 });
    expect(driver.moveMouse).toHaveBeenLastCalledWith(100, 50);
  });

  it('scrolls and presses keys', () => {
    session.begin('alice');
    session.apply({ k: 'wheel', dx: 0, dy: 100 });
    session.apply({ k: 'key', down: true, code: 'KeyA' });
    session.apply({ k: 'key', down: false, code: 'KeyA' });
    expect(driver.scrollMouse).toHaveBeenCalledWith(0, -2);
    expect(driver.keyToggle).toHaveBeenNthCalledWith(1, 'a', 'down');
    expect(driver.keyToggle).toHaveBeenNthCalledWith(2, 'a', 'up');
  });

  it('drops malformed events without touching the driver', () => {
    session.begin('alice');
    expect(session.apply({ k: 'exec' })).toBe(false);
    expect(session.apply('move')).toBe(false);
    expect(session.apply({ k: 'key', down: true, code: 'Nope' })).toBe(false);
    expect(driver.keyToggle).not.toHaveBeenCalled();
    expect(driver.moveMouse).not.toHaveBeenCalled();
  });

  it('stops applying input once the shared screen goes away', () => {
    session.begin('alice');
    bounds = null;
    expect(session.apply({ k: 'move', x: 0, y: 0 })).toBe(false);
  });

  it('releases held buttons and keys when control ends', () => {
    session.begin('alice');
    session.apply({ k: 'down', b: 'right', x: 0, y: 0 });
    session.apply({ k: 'key', down: true, code: 'ShiftLeft' });
    session.apply({ k: 'key', down: true, code: 'KeyA' });
    session.end();

    expect(driver.mouseToggle).toHaveBeenLastCalledWith('up', 'right');
    expect(driver.keyToggle).toHaveBeenCalledWith('shift', 'up');
    expect(driver.keyToggle).toHaveBeenCalledWith('a', 'up');
    expect(session.isActive).toBe(false);
    expect(session.apply({ k: 'move', x: 0, y: 0 })).toBe(false);
  });

  it('still releases the rest when one release throws', () => {
    session.begin('alice');
    session.apply({ k: 'key', down: true, code: 'ShiftLeft' });
    session.apply({ k: 'key', down: true, code: 'KeyA' });
    driver.keyToggle.mockImplementationOnce(() => {
      throw new Error('session locked');
    });
    expect(() => session.end()).not.toThrow();
    expect(driver.keyToggle).toHaveBeenCalledTimes(4);
  });

  it('rate limits events but never drops releases', () => {
    session.begin('alice');
    session.apply({ k: 'key', down: true, code: 'KeyA' });
    let applied = 0;
    for (let i = 0; i < MAX_EVENTS_PER_SECOND + 100; i++) {
      if (session.apply({ k: 'move', x: 0.5, y: 0.5 })) applied++;
    }
    expect(applied).toBe(MAX_EVENTS_PER_SECOND - 1);
    expect(session.apply({ k: 'key', down: false, code: 'KeyA' })).toBe(true);

    now += 1000;
    expect(session.apply({ k: 'move', x: 0.5, y: 0.5 })).toBe(true);
  });
});
