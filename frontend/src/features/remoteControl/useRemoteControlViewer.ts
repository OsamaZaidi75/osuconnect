import { useCallback, useEffect, useRef, useState } from 'react';
import type { RemoteParticipant, Room } from 'livekit-client';
import { ROOM_EVENT } from '../voice/livekitEvents';
import type { InputEvent, RemoteControlMessage } from './protocol';
import { REMOTE_CONTROL_TOPIC, encodeMessage, isLossy, parseMessage } from './protocol';
import { logger } from '../../utils/logger';

export type ViewerState =
  /** No answer from the sharer (a browser, or a desktop build without remote control). */
  | 'unknown'
  /** The sharer can't be controlled (a window share, Wayland, missing permission). */
  | 'unavailable'
  | 'available'
  /** Someone else is controlling. */
  | 'busy'
  | 'requesting'
  | 'controlling';

/** How long to wait for the sharer to answer before giving up. */
export const REQUEST_TIMEOUT_MS = 35_000;
const NOTICE_MS = 4_000;

/**
 * The viewer side of remote control: ask the sharer for control, send input
 * while it's granted, and track whether it's still available.
 */
export function useRemoteControlViewer(room: Room | null, sharerIdentity: string | null) {
  const [state, setStateValue] = useState<ViewerState>('unknown');
  const [notice, setNotice] = useState<string | null>(null);
  const stateRef = useRef<ViewerState>('unknown');
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setState = useCallback((next: ViewerState) => {
    stateRef.current = next;
    setStateValue(next);
  }, []);

  const showNotice = useCallback((text: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const clearRequestTimer = useCallback(() => {
    if (requestTimer.current) clearTimeout(requestTimer.current);
    requestTimer.current = null;
  }, []);

  const send = useCallback(
    (message: RemoteControlMessage) => {
      if (!room || !sharerIdentity) return;
      room.localParticipant
        .publishData(encodeMessage(message), {
          reliable: !isLossy(message),
          topic: REMOTE_CONTROL_TOPIC,
          destinationIdentities: [sharerIdentity],
        })
        .catch((error: unknown) => logger.debug('[remote-control] send failed', error));
    },
    [room, sharerIdentity],
  );

  useEffect(() => {
    if (!room || !sharerIdentity) return;
    const me = room.localParticipant.identity;

    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== REMOTE_CONTROL_TOPIC || participant?.identity !== sharerIdentity) return;
      const message = parseMessage(payload);
      if (!message) return;

      switch (message.t) {
        case 'status': {
          if (message.controller === me) {
            setState('controlling');
          } else if (!message.available) {
            clearRequestTimer();
            setState('unavailable');
          } else if (message.controller) {
            clearRequestTimer();
            setState('busy');
          } else if (stateRef.current !== 'requesting') {
            setState('available');
          }
          break;
        }
        case 'granted':
          clearRequestTimer();
          setState('controlling');
          break;
        case 'denied':
          clearRequestTimer();
          if (message.reason === 'denied') {
            setState('available');
            showNotice('Request declined');
          } else {
            setState(message.reason === 'busy' ? 'busy' : 'unavailable');
          }
          break;
        case 'revoked':
          clearRequestTimer();
          setState('available');
          showNotice(message.reason === 'stopped' ? 'Screen share stopped' : 'Control ended');
          break;
        default:
          break;
      }
    };

    const onLeft = (participant: RemoteParticipant) => {
      if (participant.identity !== sharerIdentity) return;
      clearRequestTimer();
      setState('unknown');
    };

    room.on(ROOM_EVENT.DataReceived, onData);
    room.on(ROOM_EVENT.ParticipantDisconnected, onLeft);
    send({ t: 'query' });

    return () => {
      room.off(ROOM_EVENT.DataReceived, onData);
      room.off(ROOM_EVENT.ParticipantDisconnected, onLeft);
      clearRequestTimer();
      if (stateRef.current === 'controlling') send({ t: 'release' });
      else if (stateRef.current === 'requesting') send({ t: 'cancel' });
      setState('unknown');
    };
  }, [room, sharerIdentity, send, setState, showNotice, clearRequestTimer]);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const request = useCallback(() => {
    if (stateRef.current !== 'available') return;
    send({ t: 'request' });
    setState('requesting');
    clearRequestTimer();
    requestTimer.current = setTimeout(() => {
      send({ t: 'cancel' });
      setState('available');
      showNotice('No response');
    }, REQUEST_TIMEOUT_MS);
  }, [send, setState, showNotice, clearRequestTimer]);

  const cancel = useCallback(() => {
    if (stateRef.current !== 'requesting') return;
    clearRequestTimer();
    send({ t: 'cancel' });
    setState('available');
  }, [send, setState, clearRequestTimer]);

  const release = useCallback(() => {
    if (stateRef.current !== 'controlling') return;
    send({ t: 'release' });
    setState('available');
  }, [send, setState]);

  const sendInput = useCallback(
    (event: InputEvent) => {
      if (stateRef.current !== 'controlling') return;
      send({ t: 'input', e: event });
    },
    [send],
  );

  return { state, notice, request, cancel, release, sendInput };
}
