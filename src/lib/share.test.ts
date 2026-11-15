import { describe, expect, it } from 'vitest';
import {
  decodeIntegers,
  decodePolyline,
  decodeShareState,
  encodeIntegers,
  encodePolyline,
  encodeShareState,
  fromBase64Url,
  shareToParsedTrack,
  simplifyTrack,
  toBase64Url,
  type ShareState,
} from './share';

const base: ShareState = {
  name: 'Boucle Houilles – Vallée de Chevreuse',
  startTime: Date.UTC(2026, 10, 15, 8),
  speedModel: { kind: 'power', powerW: 200, massKg: 82, cda: 0.32, crr: 0.0045 },
  reversed: true,
  layer: 'rain',
};

describe('polyline', () => {
  it('exemple de référence Google', () => {
    const pts: [number, number][] = [
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ];
    expect(encodePolyline(pts)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual(pts);
  });
  it('entiers (altitudes)', () => {
    const v = [35, 36, 40, 120, 98, -5, 0, 4807];
    expect(decodeIntegers(encodeIntegers(v))).toEqual(v);
  });
  it('base64url UTF-8', () => {
    const s = 'Vallée « test » – 🚴';
    const b = toBase64Url(s);
    expect(b).not.toMatch(/[+/=]/);
    expect(fromBase64Url(b)).toBe(s);
  });
});

describe('Douglas-Peucker', () => {
  it('supprime les points alignés, garde les angles', () => {
    const pts = Array.from({ length: 101 }, (_, i) => ({ lat: 48.9, lon: 2.18 + i * 0.0001 }));
    pts.push({ lat: 48.91, lon: 2.19 });
    const s = simplifyTrack(pts, 25);
    expect(s.length).toBe(3);
    expect(s[0]).toBe(pts[0]);
    expect(s[s.length - 1]).toBe(pts[pts.length - 1]);
  });
});

describe('encode/decode état', () => {
  it('sans trace', () => {
    const h = encodeShareState(base);
    expect(h.startsWith('s=')).toBe(true);
    const d = decodeShareState(`#${h}`)!;
    expect(d.name).toBe(base.name);
    expect(d.startTime).toBe(base.startTime);
    expect(d.speedModel).toEqual(base.speedModel);
    expect(d.reversed).toBe(true);
    expect(d.layer).toBe('rain');
    expect(d.track).toBeUndefined();
  });

  it('avec trace courte', () => {
    const track = Array.from({ length: 300 }, (_, i) => ({
      lat: 48.93 + Math.sin(i / 20) * 0.02,
      lon: 2.18 + i * 0.0008,
      ele: 40 + Math.round(Math.sin(i / 15) * 60),
    }));
    const h = encodeShareState({ ...base, track });
    expect(h.length).toBeLessThan(6000);
    const d = decodeShareState(`https://x.test/app/#${h}`)!;
    expect(d.track!.length).toBeGreaterThan(5);
    expect(d.track![0].lat).toBeCloseTo(track[0].lat, 5);
    expect(d.track![d.track!.length - 1].ele).toBe(track[track.length - 1].ele);
    const parsed = shareToParsedTrack(d)!;
    expect(parsed.source).toBe('gpx');
    expect(parsed.points[0].time).toBeNull();
  });

  it('trace trop longue → omise avec indicateur', () => {
    let seed = 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const track = Array.from({ length: 5000 }, () => ({
      lat: 45 + rnd(),
      lon: 2 + rnd(),
      ele: rnd() * 2000,
    }));
    const h = encodeShareState({ ...base, track });
    const d = decodeShareState(h)!;
    expect(d.track).toBeUndefined();
    expect(d.trackOmitted).toBe(true);
  });

  it('hash invalide', () => {
    expect(decodeShareState('')).toBeNull();
    expect(decodeShareState('#s=@@@')).toBeNull();
    expect(decodeShareState(`#s=${toBase64Url('{"v":2}')}`)).toBeNull();
  });
});
