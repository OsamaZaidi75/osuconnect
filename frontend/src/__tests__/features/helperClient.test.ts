import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHelperApi, probeHelper, readShareInfo } from '../../features/remoteControl/helperClient';

const BASE = 'http://127.0.0.1:47821';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

describe('helper client', () => {
  let calls: Call[];
  let respond: (call: Call) => unknown;
  let release: Array<() => void>;
  let gate: boolean;

  beforeEach(() => {
    calls = [];
    release = [];
    gate = false;
    respond = () => ({ ok: true });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const call: Call = {
          url: url.replace(BASE, ''),
          method: init?.method ?? 'GET',
          body: init?.body ? JSON.parse(init.body as string) : undefined,
        };
        calls.push(call);
        const result = () =>
          Promise.resolve({ ok: true, json: () => Promise.resolve(respond(call)) } as unknown as Response);
        if (!gate) return result();
        return new Promise<Response>((resolve) => release.push(() => resolve(result())));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('probeHelper', () => {
    it('is true only for the OsuConnect helper', async () => {
      respond = () => ({ ok: true, name: 'osuconnect-helper' });
      expect(await probeHelper()).toBe(true);

      respond = () => ({ ok: true, name: 'some-other-service' });
      expect(await probeHelper()).toBe(false);
    });

    it('is false when nothing is listening', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
      expect(await probeHelper()).toBe(false);
    });
  });

  describe('readShareInfo', () => {
    const track = (settings: Record<string, unknown>) =>
      ({ getSettings: () => settings }) as unknown as MediaStreamTrack;

    it('reads the surface and size of the captured screen', () => {
      expect(readShareInfo(track({ displaySurface: 'monitor', width: 1920, height: 1080 }))).toEqual({
        surface: 'monitor',
        width: 1920,
        height: 1080,
      });
    });

    it('is null when the browser does not say what is shared, or there is no track', () => {
      expect(readShareInfo(track({ width: 1920, height: 1080 }))).toBeNull();
      expect(readShareInfo(track({ displaySurface: 'monitor' }))).toBeNull();
      expect(readShareInfo(null)).toBeNull();
      expect(readShareInfo(undefined)).toBeNull();
    });
  });

  describe('createHelperApi', () => {
    it('tells the helper what is shared, then asks whether it can be controlled', async () => {
      respond = (call) => (call.url === '/rc/availability' ? { supported: true } : { ok: true });
      const api = createHelperApi(() => ({ surface: 'monitor', width: 1920, height: 1080 }));

      expect(await api.getRemoteControlAvailability()).toEqual({ supported: true });
      expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /rc/share', 'GET /rc/availability']);
      expect(calls[0].body).toEqual({ surface: 'monitor', width: 1920, height: 1080 });
      api.dispose();
    });

    it('reports a driver problem when the helper cannot be reached', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
      const api = createHelperApi(() => null);

      expect(await api.getRemoteControlAvailability()).toEqual({ supported: false, reason: 'driver' });
      api.dispose();
    });

    it('relays a control request and the answer', async () => {
      respond = () => ({ result: 'granted' });
      const api = createHelperApi(() => null);

      expect(await api.requestRemoteControl('alice', 'Alice')).toBe('granted');
      expect(calls[0]).toEqual({ url: '/rc/request', method: 'POST', body: { controllerId: 'alice', name: 'Alice' } });
      api.dispose();
    });

    it('treats a missing answer or a failure as unavailable', async () => {
      respond = () => ({});
      const api = createHelperApi(() => null);
      expect(await api.requestRemoteControl('alice', 'Alice')).toBe('unavailable');

      vi.mocked(fetch).mockRejectedValueOnce(new Error('boom'));
      expect(await api.requestRemoteControl('alice', 'Alice')).toBe('unavailable');
      api.dispose();
    });

    it('sends input in order with one batch in flight at a time', async () => {
      gate = true;
      const api = createHelperApi(() => null);

      api.sendRemoteControlInput({ k: 'down', n: 1 });
      api.sendRemoteControlInput({ k: 'up', n: 2 });
      api.sendRemoteControlInput({ k: 'move', n: 3 });
      await Promise.resolve();

      // The first batch holds only what was queued when it left; the rest waits for it
      expect(calls).toHaveLength(1);
      expect(calls[0].body).toEqual([{ k: 'down', n: 1 }]);

      release.shift()?.();
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1].body).toEqual([
        { k: 'up', n: 2 },
        { k: 'move', n: 3 },
      ]);
      release.shift()?.();
      api.dispose();
    });

    it('drops queued input when control ends', async () => {
      gate = true;
      const api = createHelperApi(() => null);
      api.sendRemoteControlInput({ k: 'down' });
      api.sendRemoteControlInput({ k: 'move' });
      await Promise.resolve();

      api.endRemoteControl();
      release.shift()?.();
      await Promise.resolve();
      await Promise.resolve();

      expect(calls.filter((c) => c.url === '/rc/input')).toHaveLength(1);
      expect(calls.some((c) => c.url === '/rc/end')).toBe(true);
      api.dispose();
    });

    it('tells the helper the share is over', () => {
      const api = createHelperApi(() => null);
      api.notifyRemoteControlShareStopped();
      expect(calls[0]).toEqual({ url: '/rc/share', method: 'POST', body: null });
      api.dispose();
    });

    it('ends control and forgets the share when disposed, and stops sending after', async () => {
      const api = createHelperApi(() => null);
      api.dispose();

      expect(calls.map((c) => c.url)).toEqual(['/rc/end', '/rc/share']);

      api.sendRemoteControlInput({ k: 'move' });
      await Promise.resolve();
      expect(calls).toHaveLength(2);
    });

    describe('stop events', () => {
      class FakeEventSource {
        static instances: FakeEventSource[] = [];
        listeners = new Map<string, (event: MessageEvent<string>) => void>();
        closed = false;
        constructor(public url: string) {
          FakeEventSource.instances.push(this);
        }
        addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
          this.listeners.set(type, listener);
        }
        close() {
          this.closed = true;
        }
        emit(type: string, data: string) {
          this.listeners.get(type)?.({ data } as MessageEvent<string>);
        }
      }

      beforeEach(() => {
        FakeEventSource.instances = [];
        vi.stubGlobal('EventSource', FakeEventSource);
      });

      it('relays the helper ending control and closes the stream on dispose', () => {
        const api = createHelperApi(() => null);
        const seen: string[] = [];
        const unsubscribe = api.onRemoteControlStopped((reason) => seen.push(reason));

        expect(FakeEventSource.instances).toHaveLength(1);
        expect(FakeEventSource.instances[0].url).toBe(`${BASE}/rc/events`);

        FakeEventSource.instances[0].emit('stopped', JSON.stringify('shortcut'));
        expect(seen).toEqual(['shortcut']);

        unsubscribe();
        FakeEventSource.instances[0].emit('stopped', JSON.stringify('error'));
        expect(seen).toEqual(['shortcut']);

        api.dispose();
        expect(FakeEventSource.instances[0].closed).toBe(true);
      });

      it('reuses one stream for several listeners', () => {
        const api = createHelperApi(() => null);
        api.onRemoteControlStopped(() => {});
        api.onRemoteControlStopped(() => {});
        expect(FakeEventSource.instances).toHaveLength(1);
        api.dispose();
      });
    });
  });
});
