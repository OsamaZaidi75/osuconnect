import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Stack,
} from '@mui/material';
import {
  loadSavedScreenShareSettings,
  saveScreenShareSettings,
  type ScreenShareSettings,
} from '../../utils/screenShareState';

const RESOLUTIONS: Array<{ value: string; label: string }> = [
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p (HD)' },
  { value: '1080p', label: '1080p (Full HD)' },
  { value: '1440p', label: '1440p (2K)' },
  { value: '4k', label: '4K (2160p)' },
  { value: 'native', label: 'Native (screen size)' },
];

const FPS_OPTIONS = [15, 30, 60];

interface ScreenShareSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onStart: (settings: ScreenShareSettings) => void;
}

/**
 * Web-only: pick quality before the browser's own source picker opens.
 * (Electron has its own picker with the same controls.)
 */
export const ScreenShareSettingsDialog: React.FC<ScreenShareSettingsDialogProps> = ({
  open,
  onClose,
  onStart,
}) => {
  const [settings, setSettings] = useState<ScreenShareSettings>(loadSavedScreenShareSettings);

  const handleStart = () => {
    saveScreenShareSettings(settings);
    onStart(settings);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        Screen share quality
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Next you will choose the screen, window or tab to share.
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          <FormControl size="small" fullWidth>
            <InputLabel id="ss-res-label">Resolution</InputLabel>
            <Select
              labelId="ss-res-label"
              label="Resolution"
              value={settings.resolution}
              onChange={(e) => setSettings((s) => ({ ...s, resolution: String(e.target.value) }))}
            >
              {RESOLUTIONS.map((r) => (
                <MenuItem key={r.value} value={r.value}>
                  {r.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" fullWidth>
            <InputLabel id="ss-fps-label">Frame rate</InputLabel>
            <Select
              labelId="ss-fps-label"
              label="Frame rate"
              value={settings.fps}
              onChange={(e) => setSettings((s) => ({ ...s, fps: Number(e.target.value) }))}
            >
              {FPS_OPTIONS.map((f) => (
                <MenuItem key={f} value={f}>
                  {f} fps
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControlLabel
            control={
              <Switch
                checked={settings.enableAudio}
                onChange={(e) => setSettings((s) => ({ ...s, enableAudio: e.target.checked }))}
              />
            }
            label="Share audio (tick &quot;Share audio&quot; in the browser picker too)"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleStart}>
          Choose screen
        </Button>
      </DialogActions>
    </Dialog>
  );
};
