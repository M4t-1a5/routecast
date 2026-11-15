import { useEffect } from 'react';
import { useApp } from '../store/useApp';

/** Durée de lecture : 4 h de sortie ≈ 20 s (bornée 8–40 s). */
export function playbackDurationMs(rideMs: number): number {
  return Math.min(40_000, Math.max(8_000, rideMs / 720));
}

/** Anime `timelineTime` quand `playing` (requestAnimationFrame). Arrêt à l'arrivée. À monter une seule fois. */
export function usePlayback() {
  const playing = useApp((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    const { settings, timing } = useApp.getState();
    if (!timing) {
      useApp.getState().setPlaying(false);
      return;
    }
    const start = settings.startTime;
    const end = timing.arrival;
    const span = Math.max(1, end - start);
    const rate = span / playbackDurationMs(span);
    let t0 = useApp.getState().timelineTime ?? start;
    if (t0 >= end - 1000) t0 = start;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      t0 = Math.min(end, t0 + dt * rate);
      useApp.getState().setTimelineTime(t0);
      if (t0 >= end) {
        useApp.getState().setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    useApp.getState().setTimelineTime(t0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}
