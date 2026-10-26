import React, { useEffect, useMemo, useState } from "react";
import { Box, Button, Paper, Typography } from "@mui/material";
import TouchAppIcon from "@mui/icons-material/TouchApp";
import type { Track } from "livekit-client";
import { useElectronAPI } from "../../contexts/ElectronContext";
import { useRoom } from "../../hooks/useRoom";
import { useLocalMediaState } from "../../hooks/useLocalMediaState";
import { TRACK_SOURCE } from "../../features/voice/livekitEvents";
import {
  hasRemoteControlApi,
  useRemoteControlHost,
  type RemoteControlHostApi,
} from "../../features/remoteControl/useRemoteControlHost";
import { createHelperApi, probeHelper, readShareInfo } from "../../features/remoteControl/helperClient";

const stopShortcutLabel = (platform?: string) => (platform === "darwin" ? "⌘⌥⇧Q" : "Ctrl+Alt+Shift+Q");

const ActiveHost: React.FC<{ api: RemoteControlHostApi; platform?: string }> = ({ api, platform }) => {
  const { room } = useRoom();
  const { isScreenShareEnabled } = useLocalMediaState();
  const { controller, stop } = useRemoteControlHost(api, room, isScreenShareEnabled);

  if (!controller) return null;

  return (
    <Paper
      role="alert"
      data-testid="remote-control-banner"
      sx={{
        position: "fixed",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: (theme) => theme.zIndex.snackbar + 1,
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 2,
        py: 1,
        maxWidth: "calc(100% - 24px)",
      }}
    >
      <TouchAppIcon color="warning" />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" noWrap>
          {controller.name} is controlling your screen
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Stop anytime with {stopShortcutLabel(platform)}
        </Typography>
      </Box>
      <Button size="small" variant="contained" color="error" onClick={stop}>
        Stop
      </Button>
    </Paper>
  );
};

/**
 * A browser can't inject input, but a person sharing from one can run the
 * desktop app's helper (`--helper`). While they share, look for it on
 * 127.0.0.1 and, if it answers, let it be controlled exactly as the desktop
 * app can.
 */
const HelperHost: React.FC = () => {
  const { room } = useRoom();
  const { isScreenShareEnabled } = useLocalMediaState();
  const [helperRunning, setHelperRunning] = useState(false);

  useEffect(() => {
    if (!isScreenShareEnabled) {
      setHelperRunning(false);
      return;
    }
    let cancelled = false;
    void probeHelper().then((running) => {
      if (!cancelled) setHelperRunning(running);
    });
    return () => {
      cancelled = true;
    };
  }, [isScreenShareEnabled]);

  const api = useMemo(
    () =>
      helperRunning && room
        ? createHelperApi(() =>
            readShareInfo(
              room.localParticipant.getTrackPublication(TRACK_SOURCE.ScreenShare as Track.Source)?.track
                ?.mediaStreamTrack,
            ),
          )
        : null,
    [helperRunning, room],
  );

  useEffect(() => () => api?.dispose(), [api]);

  if (!api) return null;
  const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  return <ActiveHost api={api} platform={mac ? "darwin" : undefined} />;
};

/**
 * Lets other participants ask to control the screen you share. The desktop app
 * does it directly; a browser needs the helper running next to it. Renders
 * nothing until someone is actually controlling.
 */
export const RemoteControlHost: React.FC = () => {
  const api = useElectronAPI();
  if (hasRemoteControlApi(api)) return <ActiveHost api={api} platform={api.platform} />;
  // Inside the desktop app without remote control (an old build) there is nothing to offer
  if (api?.isElectron) return null;
  return <HelperHost />;
};

export default RemoteControlHost;
