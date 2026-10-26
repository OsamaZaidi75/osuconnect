import React, { useCallback, useContext, useEffect, useRef } from "react";
import { Box, Button, CircularProgress, IconButton, Tooltip, Typography } from "@mui/material";
import TouchAppIcon from "@mui/icons-material/TouchApp";
import type { RemoteParticipant } from "livekit-client";
import { RoomContext } from "../../contexts/RoomContextDef";
import { useRemoteControlViewer } from "../../features/remoteControl/useRemoteControlViewer";
import { normalizePointer, type InputEvent } from "../../features/remoteControl/protocol";

type MouseButton = "left" | "middle" | "right";

const BUTTONS: Record<number, MouseButton> = { 0: "left", 1: "middle", 2: "right" };

/** DOM wheel deltas come in pixels, lines or pages. */
const wheelPixels = (delta: number, mode: number) => (mode === 1 ? delta * 16 : mode === 2 ? delta * 400 : delta);

interface Props {
  participant: RemoteParticipant;
  /** The video showing the shared screen (`object-fit: contain`). */
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

/**
 * On someone's shared screen: a button to ask to control it, and, once they
 * allow it, an overlay that turns your mouse, touch and keyboard into input on
 * their machine. Only the desktop app can be controlled; for anything else the
 * sharer never answers and this renders nothing.
 */
const RemoteControlControls: React.FC<Props> = ({ participant, videoRef }) => {
  const room = useContext(RoomContext)?.room ?? null;
  const { state, notice, request, cancel, release, sendInput } = useRemoteControlViewer(
    room,
    participant.identity,
  );
  const name = participant.name || participant.identity;

  const overlayRef = useRef<HTMLDivElement>(null);
  const lastPoint = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  const pendingMove = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef<number | null>(null);
  const pressedButtons = useRef(new Set<MouseButton>());
  const pressedKeys = useRef(new Set<string>());

  const pointAt = useCallback(
    (clientX: number, clientY: number) => {
      const video = videoRef.current;
      if (!video) return null;
      return normalizePointer(clientX, clientY, video.getBoundingClientRect(), {
        width: video.videoWidth,
        height: video.videoHeight,
      });
    },
    [videoRef],
  );

  const releaseEverything = useCallback(() => {
    for (const b of pressedButtons.current) {
      sendInput({ k: "up", b, x: lastPoint.current.x, y: lastPoint.current.y });
    }
    for (const code of pressedKeys.current) sendInput({ k: "key", down: false, code });
    pressedButtons.current.clear();
    pressedKeys.current.clear();
  }, [sendInput]);

  const controlling = state === "controlling";

  // Wheel needs a non-passive listener to stop the page scrolling underneath
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!controlling || !overlay) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      sendInput({
        k: "wheel",
        dx: wheelPixels(event.deltaX, event.deltaMode),
        dy: wheelPixels(event.deltaY, event.deltaMode),
      });
    };
    overlay.addEventListener("wheel", onWheel, { passive: false });
    overlay.focus();
    return () => overlay.removeEventListener("wheel", onWheel);
  }, [controlling, sendInput]);

  // Never leave a key or button held on their machine
  useEffect(() => {
    if (!controlling) return;
    return () => {
      releaseEverything();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [controlling, releaseEverything]);

  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  const onPointerMove = (event: React.PointerEvent) => {
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    lastPoint.current = point;
    pendingMove.current = point;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const next = pendingMove.current;
      pendingMove.current = null;
      if (next) sendInput({ k: "move", x: next.x, y: next.y });
    });
  };

  const onPointerDown = (event: React.PointerEvent) => {
    event.preventDefault();
    overlayRef.current?.focus();
    const button = BUTTONS[event.button];
    const point = pointAt(event.clientX, event.clientY);
    if (!button || !point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    lastPoint.current = point;
    pressedButtons.current.add(button);
    sendInput({ k: "down", b: button, x: point.x, y: point.y });
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const button = BUTTONS[event.button];
    if (!button || !pressedButtons.current.has(button)) return;
    const point = pointAt(event.clientX, event.clientY) ?? lastPoint.current;
    pressedButtons.current.delete(button);
    sendInput({ k: "up", b: button, x: point.x, y: point.y });
  };

  const onKey = (down: boolean) => (event: React.KeyboardEvent) => {
    // Local escape hatch, mirrors the sharer's stop shortcut
    if (down && event.ctrlKey && event.altKey && event.shiftKey && event.code === "KeyQ") {
      event.preventDefault();
      release();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (down && event.repeat) return;
    const input: InputEvent = { k: "key", down, code: event.code };
    if (down) pressedKeys.current.add(event.code);
    else pressedKeys.current.delete(event.code);
    sendInput(input);
  };

  if (state === "unknown" || state === "unavailable") return null;

  if (!controlling) {
    const label =
      state === "requesting"
        ? `Waiting for ${name} to allow control… (click to cancel)`
        : state === "busy"
        ? "Someone else is controlling this screen"
        : `Request control of ${name}'s screen`;
    return (
      <Box
        sx={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 3 }}
        onClick={stop}
        onDoubleClick={stop}
      >
        <Tooltip title={label}>
          <span>
            <IconButton
              size="small"
              aria-label={label}
              disabled={state === "busy"}
              onClick={state === "requesting" ? cancel : request}
              sx={{ backgroundColor: "rgba(0, 0, 0, 0.55)", color: "common.white", "&:hover": { backgroundColor: "rgba(0, 0, 0, 0.75)" } }}
            >
              {state === "requesting" ? <CircularProgress size={18} color="inherit" /> : <TouchAppIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
        {notice && (
          <Typography
            role="status"
            variant="caption"
            sx={{ display: "block", mt: 0.5, px: 1, borderRadius: 1, backgroundColor: "rgba(0, 0, 0, 0.7)", color: "common.white", textAlign: "center" }}
          >
            {notice}
          </Typography>
        )}
      </Box>
    );
  }

  return (
    <>
      <Box
        ref={overlayRef}
        data-testid="remote-control-overlay"
        tabIndex={0}
        role="application"
        aria-label={`Controlling ${name}'s screen`}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(event) => event.preventDefault()}
        onClick={stop}
        onDoubleClick={stop}
        onKeyDown={onKey(true)}
        onKeyUp={onKey(false)}
        onBlur={releaseEverything}
        sx={{
          position: "absolute",
          inset: 0,
          zIndex: 4,
          cursor: "crosshair",
          outline: "2px solid",
          outlineColor: "primary.main",
          outlineOffset: -2,
          touchAction: "none",
          userSelect: "none",
        }}
      />
      <Box
        sx={{
          position: "absolute",
          top: 8,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 0.5,
          borderRadius: 2,
          backgroundColor: "rgba(0, 0, 0, 0.7)",
          color: "common.white",
        }}
        onClick={stop}
        onDoubleClick={stop}
        onPointerDown={stop}
      >
        <TouchAppIcon fontSize="small" />
        <Typography variant="caption" noWrap>
          Controlling {name}&apos;s screen
        </Typography>
        <Button size="small" variant="contained" color="error" onClick={release}>
          Release
        </Button>
      </Box>
    </>
  );
};

export default RemoteControlControls;
