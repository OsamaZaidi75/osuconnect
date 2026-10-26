/**
 * Remote control of a shared screen, sharer side.
 *
 * Pure logic: validating input events from the (untrusted) data channel,
 * mapping them onto the shared screen, translating DOM keys to the input
 * driver's key names, and the single-controller session. The OS input driver
 * and the shared-screen bounds are injected (main.ts wires them), so this has
 * no Electron import and is unit-tested without it. The renderer reuses the
 * event types and parser, so the wire format has one definition.
 */

export type MouseButton = 'left' | 'middle' | 'right';

/** Loopback port the remote-control helper listens on (see helper-bridge.ts). */
export const HELPER_PORT = 47821;
export const HELPER_URL = `http://127.0.0.1:${HELPER_PORT}`;

export type InputEvent =
  | { k: 'move'; x: number; y: number }
  | { k: 'down' | 'up'; b: MouseButton; x: number; y: number }
  | { k: 'wheel'; dx: number; dy: number }
  | { k: 'key'; down: boolean; code: string };

/** The subset of the OS input library (robotjs) this module drives. */
export interface InputDriver {
  moveMouse(x: number, y: number): void;
  dragMouse(x: number, y: number): void;
  mouseToggle(direction: 'down' | 'up', button: MouseButton): void;
  scrollMouse(x: number, y: number): void;
  keyToggle(key: string, direction: 'down' | 'up'): void;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Events past this rate are dropped (releases are never dropped). */
export const MAX_EVENTS_PER_SECOND = 400;

const MAX_WHEEL_DELTA = 2000;
const MAX_WHEEL_TICKS = 10;
const PIXELS_PER_WHEEL_TICK = 50;

const MOUSE_BUTTONS: readonly MouseButton[] = ['left', 'middle', 'right'];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Physical key (KeyboardEvent.code) → the driver's key name. */
const KEY_BY_CODE: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  IntlBackslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: 'space',
  Enter: 'enter',
  NumpadEnter: 'enter',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'delete',
  Escape: 'escape',
  Insert: 'insert',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ContextMenu: 'menu',
  PrintScreen: 'printscreen',
  ShiftLeft: 'shift',
  ShiftRight: 'right_shift',
  ControlLeft: 'control',
  ControlRight: 'control',
  AltLeft: 'alt',
  AltRight: 'alt',
  MetaLeft: 'command',
  MetaRight: 'command',
  NumpadDecimal: '.',
  NumpadAdd: '+',
  NumpadSubtract: '-',
  NumpadMultiply: '*',
  NumpadDivide: '/',
};

/** The driver key name for a DOM `code`, or null when it isn't supported. */
export function domCodeToKey(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1].toLowerCase();

  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];

  const numpad = /^Numpad([0-9])$/.exec(code);
  if (numpad) return `numpad_${numpad[1]}`;

  const fn = /^F([1-9]|1[0-2])$/.exec(code);
  if (fn) return `f${fn[1]}`;

  return Object.prototype.hasOwnProperty.call(KEY_BY_CODE, code) ? KEY_BY_CODE[code] : null;
}

/**
 * Validate an input event received from the network. Returns a sanitised copy
 * (coordinates clamped to the screen, wheel deltas capped) or null when it is
 * malformed or names something unsupported.
 */
export function parseInputEvent(raw: unknown): InputEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const event = raw as Record<string, unknown>;

  switch (event.k) {
    case 'move': {
      if (!isFiniteNumber(event.x) || !isFiniteNumber(event.y)) return null;
      return { k: 'move', x: clamp(event.x, 0, 1), y: clamp(event.y, 0, 1) };
    }
    case 'down':
    case 'up': {
      if (
        !isFiniteNumber(event.x) ||
        !isFiniteNumber(event.y) ||
        typeof event.b !== 'string' ||
        !MOUSE_BUTTONS.includes(event.b as MouseButton)
      ) {
        return null;
      }
      return {
        k: event.k as 'down' | 'up',
        b: event.b as MouseButton,
        x: clamp(event.x, 0, 1),
        y: clamp(event.y, 0, 1),
      };
    }
    case 'wheel': {
      if (!isFiniteNumber(event.dx) || !isFiniteNumber(event.dy)) return null;
      return {
        k: 'wheel',
        dx: Math.round(clamp(event.dx, -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA)),
        dy: Math.round(clamp(event.dy, -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA)),
      };
    }
    case 'key': {
      if (typeof event.down !== 'boolean') return null;
      if (typeof event.code !== 'string' || event.code.length > 32) return null;
      if (domCodeToKey(event.code) === null) return null;
      return { k: 'key', down: event.down, code: event.code };
    }
    default:
      return null;
  }
}

/** A point on the shared screen from normalised (0..1) coordinates. */
export function mapNormalizedPoint(x: number, y: number, bounds: Bounds): { x: number; y: number } {
  return {
    x: Math.round(bounds.x + clamp(x, 0, 1) * Math.max(0, bounds.width - 1)),
    y: Math.round(bounds.y + clamp(y, 0, 1) * Math.max(0, bounds.height - 1)),
  };
}

/**
 * Wheel pixel deltas → driver scroll ticks. The DOM reports positive deltaY
 * for "scroll down"; the driver treats positive as "up", so vertical is
 * inverted. Horizontal keeps its sign (positive = right).
 */
export function wheelToTicks(dx: number, dy: number): { x: number; y: number } {
  const ticks = (delta: number) =>
    delta === 0
      ? 0
      : Math.sign(delta) * clamp(Math.ceil(Math.abs(delta) / PIXELS_PER_WHEEL_TICK), 1, MAX_WHEEL_TICKS);
  const vertical = ticks(dy);
  return { x: ticks(dx), y: vertical === 0 ? 0 : -vertical };
}

/**
 * The driver's scroll unit differs per OS: Windows takes 1/120ths of a wheel
 * notch (WHEEL_DELTA), macOS takes pixels, Linux X11 takes button clicks (one
 * per notch). Multiply notch counts by this before calling the driver.
 */
export function scrollUnitsPerTick(platform: string): number {
  if (platform === 'win32') return 120;
  if (platform === 'darwin') return 40;
  return 1;
}

export interface RemoteControlSessionDeps {
  driver: InputDriver;
  /**
   * Bounds of the shared screen in the driver's coordinate space, or null
   * when no screen is being shared (control is then refused).
   */
  getTargetBounds: () => Bounds | null;
  now?: () => number;
}

/**
 * One controller at a time. Input is applied only between begin() and end();
 * end() releases anything still held down so a dropped connection can't leave
 * a key or mouse button stuck on the sharer's machine.
 */
export class RemoteControlSession {
  private controller: string | null = null;
  private readonly pressedButtons = new Set<MouseButton>();
  private readonly pressedKeys = new Set<string>();
  private windowStart = 0;
  private windowCount = 0;

  constructor(private readonly deps: RemoteControlSessionDeps) {}

  get controllerId(): string | null {
    return this.controller;
  }

  get isActive(): boolean {
    return this.controller !== null;
  }

  begin(controllerId: string): boolean {
    if (this.controller !== null && this.controller !== controllerId) return false;
    if (this.deps.getTargetBounds() === null) return false;
    this.controller = controllerId;
    return true;
  }

  end(): void {
    for (const button of this.pressedButtons) this.release(() => this.deps.driver.mouseToggle('up', button));
    for (const key of this.pressedKeys) this.release(() => this.deps.driver.keyToggle(key, 'up'));
    this.pressedButtons.clear();
    this.pressedKeys.clear();
    this.controller = null;
  }

  /** Validate and apply one event. Returns whether it was applied. */
  apply(raw: unknown): boolean {
    if (this.controller === null) return false;

    const event = parseInputEvent(raw);
    if (event === null) return false;

    const bounds = this.deps.getTargetBounds();
    if (bounds === null) return false;

    const isRelease = (event.k === 'up') || (event.k === 'key' && !event.down);
    if (!isRelease && !this.withinRateLimit()) return false;

    const { driver } = this.deps;
    switch (event.k) {
      case 'move': {
        const point = mapNormalizedPoint(event.x, event.y, bounds);
        if (this.pressedButtons.size > 0) driver.dragMouse(point.x, point.y);
        else driver.moveMouse(point.x, point.y);
        return true;
      }
      case 'down': {
        const point = mapNormalizedPoint(event.x, event.y, bounds);
        driver.moveMouse(point.x, point.y);
        driver.mouseToggle('down', event.b);
        this.pressedButtons.add(event.b);
        return true;
      }
      case 'up': {
        const point = mapNormalizedPoint(event.x, event.y, bounds);
        if (this.pressedButtons.size > 0) driver.dragMouse(point.x, point.y);
        driver.mouseToggle('up', event.b);
        this.pressedButtons.delete(event.b);
        return true;
      }
      case 'wheel': {
        const ticks = wheelToTicks(event.dx, event.dy);
        if (ticks.x === 0 && ticks.y === 0) return false;
        driver.scrollMouse(ticks.x, ticks.y);
        return true;
      }
      case 'key': {
        const key = domCodeToKey(event.code);
        if (key === null) return false;
        driver.keyToggle(key, event.down ? 'down' : 'up');
        if (event.down) this.pressedKeys.add(key);
        else this.pressedKeys.delete(key);
        return true;
      }
    }
  }

  private withinRateLimit(): boolean {
    const now = (this.deps.now ?? Date.now)();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.windowCount = 0;
    }
    this.windowCount += 1;
    return this.windowCount <= MAX_EVENTS_PER_SECOND;
  }

  /** Releasing is best-effort: one failing call must not strand the rest. */
  private release(action: () => void): void {
    try {
      action();
    } catch {
      // The input driver can fail after the OS locks the session; nothing to do.
    }
  }
}
