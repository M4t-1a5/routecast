export interface RainViewerFrames {
  host: string;
  /** Passé (observé) puis nowcast. path à utiliser : `${host}${path}/256/{z}/{x}/{y}/2/1_1.png` */
  frames: { time: number; path: string; kind: 'past' | 'nowcast' }[];
}

export const RAINVIEWER_URL = 'https://api.rainviewer.com/public/weather-maps.json';

interface RvFrame {
  time?: number;
  path?: string;
}

/** Frames radar RainViewer (time converti en ms). Ne lève jamais : `{host:'', frames:[]}` en cas d'échec. */
export async function fetchRainViewerFrames(): Promise<RainViewerFrames> {
  try {
    const res = await fetch(RAINVIEWER_URL);
    if (!res.ok) return { host: '', frames: [] };
    const j = (await res.json()) as { host?: string; radar?: { past?: RvFrame[]; nowcast?: RvFrame[] } };
    const conv = (arr: RvFrame[] | undefined, kind: 'past' | 'nowcast') =>
      (arr ?? [])
        .filter((f): f is Required<RvFrame> => typeof f?.time === 'number' && typeof f?.path === 'string')
        .map((f) => ({ time: f.time * 1000, path: f.path, kind }));
    const frames = [...conv(j.radar?.past, 'past'), ...conv(j.radar?.nowcast, 'nowcast')];
    if (!j.host || !frames.length) return { host: '', frames: [] };
    return { host: j.host, frames };
  } catch {
    return { host: '', frames: [] };
  }
}
