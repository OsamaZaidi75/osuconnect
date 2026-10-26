import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { EventEmitter } from 'node:events';
import type { Room } from 'livekit-client';
import { useRemoteControlHost, hasRemoteControlApi, type RemoteControlHostApi } from '../../features/remoteControl/useRemoteControlHost';
import { useRemoteControlViewer, REQUEST_TIMEOUT_MS } from '../../features/remoteControl/useRemoteControlViewer';
import {
  REMOTE_CONTROL_TOPIC,
  encodeMessage,
  parseMessage,
  type RemoteControlMessage,
} from '../../features/remoteControl/protocol';
import { createFakeElectronAPI } from '../test-utils/fakeElectronAPI';

// Array.prototype.at exists at runtime (Node 22+) but not in this project's ES2020 lib typings
declare global {
  interface Array<T> {
    at(index: number): T | undefined;
  }
}

class FakeRoom extends EventEmitter {
  remoteParticipants = new Map<string, { identity: string; name?: string }>();
  localParticipant = { identity: 'me', publishData: vi.fn().mockResolvedValue(undefined) };

  /** A participant sends a remote-control message to this client. */
  receive(from: { identity: string; name?: string }, message: RemoteControlMessage, topic = REMOTE_CONTROL_TOPIC) {
    this.emit('dataReceived', encodeMessage(message), from, undefined, topic);
  }

  /** Everything this client published, decoded. */
  sent() {
    return this.localParticipant.publishData.mock.calls.map(([payload, options]) => ({
      message: parseMessage(payload as Uint8Array),
      options: options as { reliable: boolean; topic: string; destinationIdentities?: string[] },
    }));
  }

  sentMessages() {
    return this.sent().map((entry) => entry.message);
  }
}

const alice = { identity: 'alice', name: 'Alice' };
const bob = { identity: 'bob', name: 'Bob' };

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

describe('useRemoteControlHost', () => {
  let room: FakeRoom;
  let api: RemoteControlHostApi;
  let onStopped: (reason: string) => void;
  let requestResult: 'granted' | 'denied' | 'busy' | 'unavailable';

  const setup = async (isSharing = true) => {
    const hook = renderHook(
      ({ sharing }) => useRemoteControlHost(api, room as unknown as Room, sharing),
      { initialProps: { sharing: isSharing } },
    );
    await flush();
    return hook;
  };

  const request = async (from = alice) => {
    room.remoteParticipants.set(from.identity, from);
    await act(async () => {
      room.receive(from, { t: 'request' });
      await Promise.resolve();
    });
    await flush();
  };

  beforeEach(() => {
    room = new FakeRoom();
    requestResult = 'granted';
    api = {
      getRemoteControlAvailability: vi.fn().mockResolvedValue({ supported: true }),
      requestRemoteControl: vi.fn().mockImplementation(() => Promise.resolve(requestResult)),
      sendRemoteControlInput: vi.fn(),
      endRemoteControl: vi.fn(),
      notifyRemoteControlShareStopped: vi.fn(),
      onRemoteControlStopped: vi.fn().mockImplementation((callback: (reason: string) => void) => {
        onStopped = callback;
        return () => {};
      }),
    };
  });

  it('announces that the screen can be controlled once sharing starts', async () => {
    await setup();
    expect(room.sentMessages()).toContainEqual({ t: 'status', available: true, controller: null });
  });

  it('reports that it cannot be controlled, and refuses requests, when the machine is unsupported', async () => {
    vi.mocked(api.getRemoteControlAvailability).mockResolvedValue({ supported: false, reason: 'wayland' });
    await setup();
    expect(room.sentMessages()).toContainEqual({ t: 'status', available: false, controller: null });

    await request();
    expect(api.requestRemoteControl).not.toHaveBeenCalled();
    expect(room.sent().at(-1)).toMatchObject({
      message: { t: 'denied', reason: 'unavailable' },
      options: { destinationIdentities: ['alice'] },
    });
  });

  it('answers a status query for the asker only', async () => {
    await setup();
    room.localParticipant.publishData.mockClear();
    await act(async () => room.receive(alice, { t: 'query' }));
    expect(room.sent()).toEqual([
      expect.objectContaining({
        message: { t: 'status', available: true, controller: null },
        options: expect.objectContaining({ destinationIdentities: ['alice'] }),
      }),
    ]);
  });

  it('ignores traffic on other topics', async () => {
    await setup();
    await act(async () => room.receive(alice, { t: 'request' }, 'something-else'));
    expect(api.requestRemoteControl).not.toHaveBeenCalled();
  });

  it('asks the user, then grants control and tells everyone', async () => {
    const { result } = await setup();
    await request();

    expect(api.requestRemoteControl).toHaveBeenCalledWith('alice', 'Alice');
    expect(result.current.controller).toEqual({ identity: 'alice', name: 'Alice' });
    const messages = room.sentMessages();
    expect(messages).toContainEqual({ t: 'granted' });
    expect(messages.at(-1)).toEqual({ t: 'status', available: true, controller: 'alice' });
  });

  it('does not grant control when the user denies', async () => {
    requestResult = 'denied';
    const { result } = await setup();
    await request();

    expect(result.current.controller).toBeNull();
    expect(room.sentMessages()).toContainEqual({ t: 'denied', reason: 'denied' });
    expect(api.endRemoteControl).not.toHaveBeenCalled();
  });

  it('tells a second requester that someone else is in control', async () => {
    await setup();
    await request(alice);
    await request(bob);

    expect(api.requestRemoteControl).toHaveBeenCalledTimes(1);
    expect(room.sent().at(-1)).toMatchObject({
      message: { t: 'denied', reason: 'busy' },
      options: { destinationIdentities: ['bob'] },
    });
  });

  it('forwards input only from the approved controller', async () => {
    await setup();
    await request(alice);

    await act(async () => room.receive(alice, { t: 'input', e: { k: 'move', x: 0.1, y: 0.2 } }));
    await act(async () => room.receive(bob, { t: 'input', e: { k: 'move', x: 0.9, y: 0.9 } }));

    expect(api.sendRemoteControlInput).toHaveBeenCalledTimes(1);
    expect(api.sendRemoteControlInput).toHaveBeenCalledWith({ k: 'move', x: 0.1, y: 0.2 });
  });

  it('forwards no input before control is granted', async () => {
    await setup();
    await act(async () => room.receive(alice, { t: 'input', e: { k: 'move', x: 0.1, y: 0.2 } }));
    expect(api.sendRemoteControlInput).not.toHaveBeenCalled();
  });

  it('ends control when the controller releases it', async () => {
    const { result } = await setup();
    await request();
    await act(async () => room.receive(alice, { t: 'release' }));

    expect(result.current.controller).toBeNull();
    expect(api.endRemoteControl).toHaveBeenCalledTimes(1);
    expect(room.sentMessages()).not.toContainEqual({ t: 'revoked', reason: 'sharer' });
  });

  it('lets the sharer stop control and tells the controller', async () => {
    const { result } = await setup();
    await request();
    act(() => result.current.stop());

    expect(result.current.controller).toBeNull();
    expect(api.endRemoteControl).toHaveBeenCalledTimes(1);
    expect(room.sent().find((entry) => entry.message?.t === 'revoked')).toMatchObject({
      message: { t: 'revoked', reason: 'sharer' },
      options: { destinationIdentities: ['alice'] },
    });
  });

  it('ends control when the controller leaves the call', async () => {
    const { result } = await setup();
    await request();
    await act(async () => room.emit('participantDisconnected', alice));

    expect(result.current.controller).toBeNull();
    expect(api.endRemoteControl).toHaveBeenCalledTimes(1);
  });

  it('ends control and tells the desktop app when sharing stops', async () => {
    const { result, rerender } = await setup();
    await request();
    rerender({ sharing: false });
    await flush();

    expect(result.current.controller).toBeNull();
    expect(api.endRemoteControl).toHaveBeenCalledTimes(1);
    expect(api.notifyRemoteControlShareStopped).toHaveBeenCalledTimes(1);
    expect(room.sentMessages()).toContainEqual({ t: 'revoked', reason: 'stopped' });
    expect(room.sentMessages().at(-1)).toEqual({ t: 'status', available: false, controller: null });
  });

  it('does not tell the desktop app about a share that never started', async () => {
    await setup(false);
    expect(api.notifyRemoteControlShareStopped).not.toHaveBeenCalled();
    expect(api.getRemoteControlAvailability).not.toHaveBeenCalled();
  });

  it('follows the desktop app when it ends control itself (stop shortcut)', async () => {
    const { result } = await setup();
    await request();
    await act(async () => onStopped('shortcut'));

    expect(result.current.controller).toBeNull();
    expect(api.endRemoteControl).not.toHaveBeenCalled();
    expect(room.sentMessages()).toContainEqual({ t: 'revoked', reason: 'sharer' });
  });

  it('ends control that was granted after the requester gave up', async () => {
    let answer: (value: 'granted') => void = () => {};
    vi.mocked(api.requestRemoteControl).mockImplementation(
      () =>
        new Promise<'granted'>((resolve) => {
          answer = resolve;
        }),
    );
    const { result } = await setup();
    room.remoteParticipants.set('alice', alice);
    await act(async () => room.receive(alice, { t: 'request' }));
    await act(async () => room.receive(alice, { t: 'cancel' }));
    await act(async () => answer('granted'));

    expect(result.current.controller).toBeNull();
    expect(api.endRemoteControl).toHaveBeenCalledTimes(1);
  });
});

describe('hasRemoteControlApi', () => {
  it('accepts a bridge with remote control and rejects older ones', () => {
    expect(hasRemoteControlApi(createFakeElectronAPI())).toBe(true);
    expect(hasRemoteControlApi(null)).toBe(false);
    expect(hasRemoteControlApi({ isElectron: true })).toBe(false);
  });
});

describe('useRemoteControlViewer', () => {
  let room: FakeRoom;

  const setup = () => renderHook(() => useRemoteControlViewer(room as unknown as Room, 'alice'));

  const status = (available: boolean, controller: string | null) =>
    act(async () => room.receive(alice, { t: 'status', available, controller }));

  beforeEach(() => {
    room = new FakeRoom();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks the sharer whether it can be controlled', () => {
    setup();
    expect(room.sent()).toEqual([
      expect.objectContaining({
        message: { t: 'query' },
        options: expect.objectContaining({ destinationIdentities: ['alice'], topic: REMOTE_CONTROL_TOPIC }),
      }),
    ]);
  });

  it('stays unknown without an answer (a browser sharer)', () => {
    const { result } = setup();
    expect(result.current.state).toBe('unknown');
  });

  it.each([
    [true, null, 'available'],
    [false, null, 'unavailable'],
    [true, 'bob', 'busy'],
    [true, 'me', 'controlling'],
  ] as const)('maps status (available=%s, controller=%s) to %s', async (available, controller, expected) => {
    const { result } = setup();
    await status(available, controller);
    expect(result.current.state).toBe(expected);
  });

  it('ignores messages from anyone but the sharer', async () => {
    const { result } = setup();
    await act(async () => room.receive(bob, { t: 'status', available: true, controller: null }));
    expect(result.current.state).toBe('unknown');
  });

  it('requests, then controls once granted', async () => {
    const { result } = setup();
    await status(true, null);
    act(() => result.current.request());
    expect(result.current.state).toBe('requesting');
    expect(room.sentMessages().at(-1)).toEqual({ t: 'request' });

    await act(async () => room.receive(alice, { t: 'granted' }));
    expect(result.current.state).toBe('controlling');
  });

  it('only requests when the sharer is available', async () => {
    const { result } = setup();
    act(() => result.current.request());
    expect(room.sentMessages()).not.toContainEqual({ t: 'request' });
  });

  it('stays requesting through unrelated status updates', async () => {
    const { result } = setup();
    await status(true, null);
    act(() => result.current.request());
    await status(true, null);
    expect(result.current.state).toBe('requesting');
  });

  it('goes back to available with a notice when declined', async () => {
    const { result } = setup();
    await status(true, null);
    act(() => result.current.request());
    await act(async () => room.receive(alice, { t: 'denied', reason: 'denied' }));
    expect(result.current.state).toBe('available');
    expect(result.current.notice).toBe('Request declined');
  });

  it('shows busy when someone else is controlling', async () => {
    const { result } = setup();
    await status(true, null);
    act(() => result.current.request());
    await act(async () => room.receive(alice, { t: 'denied', reason: 'busy' }));
    expect(result.current.state).toBe('busy');
  });

  it('gives up after the request times out', async () => {
    vi.useFakeTimers();
    const { result } = setup();
    await status(true, null);
    act(() => result.current.request());
    act(() => {
      vi.advanceTimersByTime(REQUEST_TIMEOUT_MS);
    });
    expect(result.current.state).toBe('available');
    expect(result.current.notice).toBe('No response');
    expect(room.sentMessages().at(-1)).toEqual({ t: 'cancel' });
  });

  it('lets the viewer cancel a pending request', async () => {
    const { result } = setup();
    await status(true, null);
    act(() => result.current.request());
    act(() => result.current.cancel());
    expect(result.current.state).toBe('available');
    expect(room.sentMessages().at(-1)).toEqual({ t: 'cancel' });
  });

  it('sends input only while controlling, lossy for moves and reliable for clicks', async () => {
    const { result } = setup();
    await status(true, null);
    act(() => result.current.sendInput({ k: 'move', x: 0, y: 0 }));
    expect(room.sentMessages()).not.toContainEqual(expect.objectContaining({ t: 'input' }));

    await status(true, 'me');
    act(() => {
      result.current.sendInput({ k: 'move', x: 0.5, y: 0.5 });
      result.current.sendInput({ k: 'down', b: 'left', x: 0.5, y: 0.5 });
    });
    const inputs = room.sent().filter((entry) => entry.message?.t === 'input');
    expect(inputs.map((entry) => entry.options.reliable)).toEqual([false, true]);
  });

  it('releases control and goes back to available', async () => {
    const { result } = setup();
    await status(true, 'me');
    act(() => result.current.release());
    expect(result.current.state).toBe('available');
    expect(room.sentMessages().at(-1)).toEqual({ t: 'release' });
  });

  it('follows the sharer when control is revoked', async () => {
    const { result } = setup();
    await status(true, 'me');
    await act(async () => room.receive(alice, { t: 'revoked', reason: 'stopped' }));
    expect(result.current.state).toBe('available');
    expect(result.current.notice).toBe('Screen share stopped');
  });

  it('forgets everything when the sharer leaves', async () => {
    const { result } = setup();
    await status(true, null);
    await act(async () => room.emit('participantDisconnected', alice));
    expect(result.current.state).toBe('unknown');
  });

  it('gives control back when the tile goes away', async () => {
    const { result, unmount } = setup();
    await status(true, 'me');
    expect(result.current.state).toBe('controlling');
    unmount();
    expect(room.sentMessages().at(-1)).toEqual({ t: 'release' });
  });
});
