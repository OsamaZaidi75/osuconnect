import { useCallback, useEffect, useRef, useState } from 'react';
import type { RemoteParticipant, Room } from 'livekit-client';
import { ROOM_EVENT } from '../voice/livekitEvents';
import type { DenyReason, RemoteControlMessage } from './protocol';
import { REMOTE_CONTROL_TOPIC, encodeMessage, isLossy, parseMessage } from './protocol';
import type { ElectronAPI, RemoteControlRequestResult } from '../../types/electron-api';
import { logger } from '../../utils/logger';

/** The desktop-app bridge methods the sharer side needs. */
export type RemoteControlHostApi = Required<
  Pick<
    ElectronAPI,
    | 'getRemoteControlAvailability'
    | 'requestRemoteControl'
    | 'sendRemoteControlInput'
    | 'endRemoteControl'
    | 'notifyRemoteControlShareStopped'
    | 'onRemoteControlStopped'
  >
>;

/** Narrows the bridge to one that supports remote control (older desktop builds don't). */
export function hasRemoteControlApi(api: ElectronAPI | null): api is ElectronAPI & RemoteControlHostApi {
  return (
    api !== null &&
    typeof api.getRemoteControlAvailability === 'function' &&
    typeof api.requestRemoteControl === 'function' &&
    typeof api.sendRemoteControlInput === 'function' &&
    typeof api.endRemoteControl === 'function' &&
    typeof api.notifyRemoteControlShareStopped === 'function' &&
    typeof api.onRemoteControlStopped === 'function'
  );
}

export interface RemoteController {
  identity: string;
  name: string;
}

type EndReason = 'sharer' | 'stopped' | 'viewer' | 'main';

/**
 * The sharer side of remote control. While the user shares a screen in the
 * desktop app, another participant can ask to control it: the user approves in
 * a native dialog (main process), and only the approved participant's input is
 * forwarded to the OS. Control ends when the user stops it, the share stops,
 * the controller leaves, or the stop shortcut is pressed.
 */
export function useRemoteControlHost(
  api: RemoteControlHostApi,
  room: Room | null,
  isScreenSharing: boolean,
): { controller: RemoteController | null; stop: () => void } {
  const [controller, setController] = useState<RemoteController | null>(null);
  const controllerRef = useRef<RemoteController | null>(null);
  const pendingRef = useRef<string | null>(null);
  const availableRef = useRef(false);
  const wasSharingRef = useRef(false);

  const send = useCallback(
    (message: RemoteControlMessage, destination?: string[]) => {
      if (!room) return;
      room.localParticipant
        .publishData(encodeMessage(message), {
          reliable: !isLossy(message),
          topic: REMOTE_CONTROL_TOPIC,
          destinationIdentities: destination,
        })
        .catch((error: unknown) => logger.debug('[remote-control] send failed', error));
    },
    [room],
  );

  const broadcastStatus = useCallback(
    (to?: string[]) => {
      send(
        { t: 'status', available: availableRef.current, controller: controllerRef.current?.identity ?? null },
        to,
      );
    },
    [send],
  );

  const setCurrentController = useCallback((next: RemoteController | null) => {
    controllerRef.current = next;
    setController(next);
  }, []);

  const endControl = useCallback(
    (reason: EndReason) => {
      const current = controllerRef.current;
      if (!current) return;
      setCurrentController(null);
      // 'main' means the main process already ended it
      if (reason !== 'main') api.endRemoteControl();
      if (reason !== 'viewer') {
        send({ t: 'revoked', reason: reason === 'stopped' ? 'stopped' : 'sharer' }, [current.identity]);
      }
      broadcastStatus();
    },
    [api, send, broadcastStatus, setCurrentController],
  );

  const handleRequest = useCallback(
    async (participant: RemoteParticipant) => {
      const identity = participant.identity;
      const name = participant.name || identity;
      const deny = (reason: DenyReason) => send({ t: 'denied', reason }, [identity]);

      if (!availableRef.current) return deny('unavailable');

      const current = controllerRef.current;
      if (current?.identity === identity) {
        send({ t: 'granted' }, [identity]);
        return;
      }
      if (current || pendingRef.current) return deny('busy');

      pendingRef.current = identity;
      let result: RemoteControlRequestResult;
      try {
        result = await api.requestRemoteControl(identity, name);
      } catch {
        result = 'unavailable';
      }
      // They may have cancelled or left while the dialog was open
      const stillWanted = pendingRef.current === identity && room?.remoteParticipants.has(identity) === true;
      pendingRef.current = null;

      if (result !== 'granted') return deny(result);
      if (!stillWanted) {
        api.endRemoteControl();
        return;
      }
      setCurrentController({ identity, name });
      send({ t: 'granted' }, [identity]);
      broadcastStatus();
    },
    [api, room, send, broadcastStatus, setCurrentController],
  );

  // Messages from other participants
  useEffect(() => {
    if (!room) return;

    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== REMOTE_CONTROL_TOPIC || !participant) return;
      const message = parseMessage(payload);
      if (!message) return;

      switch (message.t) {
        case 'query':
          broadcastStatus([participant.identity]);
          break;
        case 'request':
          void handleRequest(participant);
          break;
        case 'cancel':
          if (pendingRef.current === participant.identity) pendingRef.current = null;
          break;
        case 'release':
          if (controllerRef.current?.identity === participant.identity) endControl('viewer');
          break;
        case 'input':
          if (controllerRef.current?.identity === participant.identity) api.sendRemoteControlInput(message.e);
          break;
        default:
          break;
      }
    };

    const onLeft = (participant: RemoteParticipant) => {
      if (pendingRef.current === participant.identity) pendingRef.current = null;
      if (controllerRef.current?.identity === participant.identity) endControl('viewer');
    };

    room.on(ROOM_EVENT.DataReceived, onData);
    room.on(ROOM_EVENT.ParticipantDisconnected, onLeft);
    return () => {
      room.off(ROOM_EVENT.DataReceived, onData);
      room.off(ROOM_EVENT.ParticipantDisconnected, onLeft);
      endControl('stopped');
    };
  }, [room, api, broadcastStatus, handleRequest, endControl]);

  // Sharing started or stopped
  useEffect(() => {
    let cancelled = false;

    if (isScreenSharing) {
      wasSharingRef.current = true;
      api
        .getRemoteControlAvailability()
        .then((availability) => {
          if (cancelled) return;
          availableRef.current = availability.supported;
          broadcastStatus();
        })
        .catch((error: unknown) => logger.debug('[remote-control] availability check failed', error));
    } else if (wasSharingRef.current) {
      wasSharingRef.current = false;
      endControl('stopped');
      api.notifyRemoteControlShareStopped();
      availableRef.current = false;
      broadcastStatus();
    }

    return () => {
      cancelled = true;
    };
  }, [isScreenSharing, api, broadcastStatus, endControl]);

  // Main ended control itself (stop shortcut, share changed, input failure)
  useEffect(() => api.onRemoteControlStopped(() => endControl('main')), [api, endControl]);

  const stop = useCallback(() => endControl('sharer'), [endControl]);

  return { controller, stop };
}
