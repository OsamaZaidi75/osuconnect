import { useEffect, useState, type RefObject } from 'react';

export interface VideoStreamStats {
  height: number;
  fps: number;
}

/**
 * Measured resolution (the video element's decoded height) and frame rate
 * (decoded frames per second) of what the element is playing right now.
 */
export function useVideoStreamStats(
  ref: RefObject<HTMLVideoElement | null>,
  active: boolean,
): VideoStreamStats | null {
  const [stats, setStats] = useState<VideoStreamStats | null>(null);

  useEffect(() => {
    if (!active) {
      setStats(null);
      return;
    }
    let lastFrames = ref.current?.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
    let lastTime = performance.now();

    const id = window.setInterval(() => {
      const el = ref.current;
      if (!el || !el.videoHeight) return;
      const now = performance.now();
      const frames = el.getVideoPlaybackQuality?.().totalVideoFrames ?? lastFrames;
      const fps = Math.round(((frames - lastFrames) * 1000) / Math.max(now - lastTime, 1));
      lastFrames = frames;
      lastTime = now;
      setStats((prev) =>
        prev && prev.height === el.videoHeight && prev.fps === fps
          ? prev
          : { height: el.videoHeight, fps },
      );
    }, 1000);

    return () => window.clearInterval(id);
  }, [ref, active]);

  return stats;
}
