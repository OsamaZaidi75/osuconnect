/**
 * Screen Share State Management
 *
 * Manages screen share settings for Electron integration.
 * Uses window properties for Electron main process communication,
 * but provides a type-safe interface and proper cleanup.
 */

export interface ScreenShareSettings {
  resolution: string;
  fps: number;
  enableAudio: boolean;
}

/**
 * Set screen share configuration for Electron
 * These values are read by Electron's main process setDisplayMediaRequestHandler
 */
export function setScreenShareConfig(sourceId: string, settings: ScreenShareSettings): void {
  if (typeof window !== 'undefined') {
    window.__selectedScreenSourceId = sourceId;
    window.__screenShareSettings = settings;
  }
}

/**
 * Set only the quality settings (web: the browser's own picker chooses the source)
 */
export function setScreenShareSettings(settings: ScreenShareSettings): void {
  if (typeof window !== 'undefined') {
    window.__screenShareSettings = settings;
  }
}

// Same key as the Electron picker, so both platforms remember one choice.
const SAVED_SETTINGS_KEY = 'semaphore_screen_share_settings';

export function loadSavedScreenShareSettings(): ScreenShareSettings {
  try {
    const saved = localStorage.getItem(SAVED_SETTINGS_KEY);
    if (saved) {
      return { ...DEFAULT_SCREEN_SHARE_SETTINGS, ...JSON.parse(saved) };
    }
  } catch {
    // fall through to the defaults
  }
  return { ...DEFAULT_SCREEN_SHARE_SETTINGS };
}

export function saveScreenShareSettings(settings: ScreenShareSettings): void {
  try {
    localStorage.setItem(SAVED_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable: the choice just isn't remembered
  }
}

/**
 * Get screen share settings
 */
export function getScreenShareSettings(): ScreenShareSettings | undefined {
  if (typeof window !== 'undefined') {
    return window.__screenShareSettings;
  }
  return undefined;
}

/**
 * Get selected screen source ID
 */
export function getScreenSourceId(): string | undefined {
  if (typeof window !== 'undefined') {
    return window.__selectedScreenSourceId;
  }
  return undefined;
}

/**
 * Clear screen share configuration
 * Should be called when screen sharing ends
 */
export function clearScreenShareConfig(): void {
  if (typeof window !== 'undefined') {
    delete window.__selectedScreenSourceId;
    delete window.__screenShareSettings;
  }
}

/**
 * Default screen share settings
 */
// Matches the Electron picker's default (ScreenSourcePicker). The web settings
// dialog starts from this too; the browser's own picker chooses the source.
export const DEFAULT_SCREEN_SHARE_SETTINGS: ScreenShareSettings = {
  resolution: '1080p',
  fps: 60,
  enableAudio: true,
};
