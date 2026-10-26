import React from "react";
import { Box, Button, Paper, Typography } from "@mui/material";
import TouchAppIcon from "@mui/icons-material/TouchApp";
import { useElectronAPI } from "../../contexts/ElectronContext";
import { useRoom } from "../../hooks/useRoom";
import { useLocalMediaState } from "../../hooks/useLocalMediaState";
import {
  hasRemoteControlApi,
  useRemoteControlHost,
  type RemoteControlHostApi,
} from "../../features/remoteControl/useRemoteControlHost";

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
 * Lets other participants ask to control the screen you share. Renders nothing
 * outside the desktop app (a browser can't inject input) and nothing until
 * someone is actually controlling.
 */
export const RemoteControlHost: React.FC = () => {
  const api = useElectronAPI();
  if (!hasRemoteControlApi(api)) return null;
  return <ActiveHost api={api} platform={api.platform} />;
};

export default RemoteControlHost;
