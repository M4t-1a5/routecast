// OWNER: agent UI. Profil d'altitude interactif (uPlot), synchronisé via useApp.hoverIndex.
import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useApp } from '../../store/useApp';
import { indexAtDistance, positionAtTime } from '../route';
import { WIND_RELATION_COLORS } from '../../lib/colors';
import { fmtTime } from '../../lib/format';
import type { ProfileOverlay } from '../../types';
import { Segmented, Skeleton } from '../../components/ui';
import { cx } from '../../lib/cx';
import { WeatherIcon, WindArrow } from '../../components/icons';
import { GRADE_LEGEND, elevationRange, gradeRuns, overlayRange, overlaySeries } from './profileData';

const OVERLAYS: { value: ProfileOverlay; label: string }[] = [
  { value: 'none', label: 'Relief' },
  { value: 'wind', label: 'Vent' },
  { value: 'temperature', label: 'Temp.' },
  { value: 'rain', label: 'Pluie' },
];
const REL = { head: 'de face', tail: 'de dos', cross: 'de travers' } as const;
const dec = (v: number, d = 1) =>
  v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

function palette(dark: boolean) {
  return dark
    ? { axis: '#94a3b8', grid: 'rgba(255,255,255,0.06)', line: '#f1f5f9', marker: '#38bdf8' }
    : { axis: '#475569', grid: 'rgba(15,23,42,0.07)', line: '#0f172a', marker: '#2563eb' };
}

export default function ElevationProfile({ className }: { className?: string }) {
  const route = useApp((s) => s.route);
  const timing = useApp((s) => s.timing);
  const weather = useApp((s) => s.weather);
  const ws = useApp((s) => s.weatherStatus);
  const overlay = useApp((s) => s.profileOverlay);
  const setOverlay = useApp((s) => s.setProfileOverlay);
  const hoverIndex = useApp((s) => s.hoverIndex);
  const timelineTime = useApp((s) => s.timelineTime);
  const dark = useApp((s) => s.theme === 'dark');

  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const fromPlot = useRef<number | null | undefined>(undefined);
  const syncing = useRef(false);
  const markerKm = useRef<number | null>(null);
  const [ready, setReady] = useState(0);

  const points = useMemo(() => route?.points ?? [], [route]);
  const km = useMemo(() => points.map((p) => p.dist / 1000), [points]);

  /* ------------------------- construction du graphe ------------------------- */
  useEffect(() => {
    const el = box.current;
    if (!el || points.length < 2 || !route) return;
    const pal = palette(dark);
    const ele = points.map((p) => p.ele);
    const ov = overlaySeries(overlay, points.length, weather);
    const runs = gradeRuns(points);
    const [ymin, ymax] = elevationRange(route.stats.minEle, route.stats.maxEle);
    const y2 = ov ? overlayRange(overlay, ov) : ([0, 1] as [number, number]);

    const fillGrades = (u: uPlot) => {
      const ctx = u.ctx;
      const base = u.bbox.top + u.bbox.height;
      ctx.save();
      ctx.beginPath();
      ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
      ctx.clip();
      ctx.globalAlpha = ov ? (dark ? 0.4 : 0.35) : dark ? 0.78 : 0.7;
      for (const r of runs) {
        ctx.beginPath();
        ctx.moveTo(u.valToPos(km[r.start], 'x', true), base);
        for (let i = r.start; i <= r.end; i++)
          ctx.lineTo(u.valToPos(km[i], 'x', true), u.valToPos(ele[i], 'y', true));
        ctx.lineTo(u.valToPos(km[r.end], 'x', true), base);
        ctx.closePath();
        ctx.fillStyle = r.color;
        ctx.fill();
      }
      // voile dégradé vers le bas pour la profondeur
      const g = ctx.createLinearGradient(0, u.bbox.top, 0, base);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, dark ? 'rgba(2,6,23,0.55)' : 'rgba(255,255,255,0.5)');
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = g;
      ctx.fillRect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
      ctx.restore();
    };

    const drawOverlayBars = (u: uPlot) => {
      if (!ov || (overlay !== 'wind' && overlay !== 'rain')) return;
      const ctx = u.ctx;
      const zero = u.valToPos(0, 'y2', true);
      ctx.save();
      ctx.beginPath();
      ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
      ctx.clip();
      for (let i = 0; i < ov.length - 1; i++) {
        const v = ov[i];
        if (v == null || v === 0) continue;
        const x0 = u.valToPos(km[i], 'x', true);
        const x1 = u.valToPos(km[i + 1], 'x', true);
        const y = u.valToPos(v, 'y2', true);
        ctx.fillStyle =
          overlay === 'rain'
            ? 'rgba(59,130,246,0.8)'
            : v > 0
              ? `${WIND_RELATION_COLORS.tail}b3`
              : `${WIND_RELATION_COLORS.head}b3`;
        ctx.fillRect(x0, Math.min(y, zero), Math.max(1, x1 - x0 - 0.5), Math.abs(zero - y));
      }
      if (overlay === 'wind') {
        ctx.strokeStyle = pal.axis;
        ctx.globalAlpha = 0.6;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(u.bbox.left, zero);
        ctx.lineTo(u.bbox.left + u.bbox.width, zero);
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawMarker = (u: uPlot) => {
      const k = markerKm.current;
      if (k == null) return;
      const ctx = u.ctx;
      const x = u.valToPos(k, 'x', true);
      let i = 0;
      while (i < km.length - 2 && km[i + 1] < k) i++;
      const t = km[i + 1] > km[i] ? Math.min(1, Math.max(0, (k - km[i]) / (km[i + 1] - km[i]))) : 0;
      const y = u.valToPos(ele[i] + (ele[i + 1] - ele[i]) * t, 'y', true);
      const dpr = devicePixelRatio || 1;
      ctx.save();
      ctx.strokeStyle = pal.marker;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(x, u.bbox.top);
      ctx.lineTo(x, u.bbox.top + u.bbox.height);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, y, 6 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pal.marker;
      ctx.beginPath();
      ctx.arc(x, y, 4 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const series: uPlot.Series[] = [
      {},
      { label: 'Altitude', scale: 'y', stroke: pal.line, width: 1.6, points: { show: false } },
    ];
    const data: uPlot.AlignedData = [km, ele];
    if (ov) {
      series.push(
        overlay === 'temperature'
          ? {
              label: 'Température',
              scale: 'y2',
              stroke: '#fb923c',
              width: 2,
              points: { show: false },
              spanGaps: true,
            }
          : { label: overlay, scale: 'y2', paths: () => null, points: { show: false } },
      );
      (data as unknown as (number | null)[][]).push(ov);
    }

    const axisFont = '11px "Inter Variable", system-ui, sans-serif';
    const axes: uPlot.Axis[] = [
      {
        stroke: pal.axis,
        font: axisFont,
        grid: { stroke: pal.grid, width: 1 },
        ticks: { show: false },
        size: 26,
        values: (_u, vals) => vals.map((v) => `${v.toLocaleString('fr-FR')} km`),
      },
      {
        scale: 'y',
        stroke: pal.axis,
        font: axisFont,
        grid: { stroke: pal.grid, width: 1 },
        ticks: { show: false },
        size: 46,
        values: (_u, vals) => vals.map((v) => `${Math.round(v)} m`),
      },
    ];
    if (ov) {
      axes.push({
        scale: 'y2',
        side: 1,
        stroke: overlay === 'temperature' ? '#fb923c' : overlay === 'rain' ? '#60a5fa' : pal.axis,
        font: axisFont,
        grid: { show: false },
        ticks: { show: false },
        size: 50,
        values: (_u, vals) =>
          vals.map((v) =>
            overlay === 'temperature'
              ? `${Math.round(v)}°`
              : overlay === 'rain'
                ? `${dec(v, 1)}`
                : `${Math.round(v)}`,
          ),
      });
    }

    const opts: uPlot.Options = {
      width: Math.max(100, el.clientWidth),
      height: Math.max(80, el.clientHeight),
      padding: [8, ov ? 4 : 12, 0, 0],
      legend: { show: false },
      scales: {
        x: { time: false, range: [km[0], km[km.length - 1]] },
        y: { range: [ymin, ymax] },
        y2: { range: y2 },
      },
      axes,
      series,
      cursor: {
        drag: { x: false, y: false, setScale: false },
        points: { size: 9, fill: pal.marker, stroke: '#fff', width: 2 } as uPlot.Cursor.Points,
        y: false,
      },
      hooks: {
        drawAxes: [fillGrades],
        draw: [drawOverlayBars, drawMarker],
        setCursor: [
          (u) => {
            if (syncing.current) return;
            const left = u.cursor.left;
            if (left == null || left < 0) {
              fromPlot.current = null;
              useApp.getState().setHoverIndex(null);
              return;
            }
            const r = useApp.getState().route;
            if (!r) return;
            const idx = indexAtDistance(r, u.posToVal(left, 'x') * 1000);
            fromPlot.current = idx;
            useApp.getState().setHoverIndex(idx);
          },
        ],
      },
    };

    const u = new uPlot(opts, data, el);
    plot.current = u;
    setReady((n) => n + 1);

    // Tactile : glisser le doigt déplace le curseur.
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const rect = u.over.getBoundingClientRect();
      u.setCursor({ left: Math.max(0, Math.min(rect.width, t.clientX - rect.left)), top: rect.height / 2 });
    };
    u.over.addEventListener('touchstart', onTouch, { passive: true });
    u.over.addEventListener('touchmove', onTouch, { passive: true });

    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0)
        u.setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.over.removeEventListener('touchstart', onTouch);
      u.over.removeEventListener('touchmove', onTouch);
      u.destroy();
      plot.current = null;
    };
  }, [route, points, km, weather, overlay, dark]);

  /* ------------------- curseur synchronisé depuis la carte ------------------- */
  useEffect(() => {
    const u = plot.current;
    if (!u || hoverIndex === fromPlot.current) return;
    fromPlot.current = undefined;
    syncing.current = true;
    if (hoverIndex == null || km[hoverIndex] == null) u.setCursor({ left: -10, top: -10 });
    else u.setCursor({ left: u.valToPos(km[hoverIndex], 'x'), top: u.over.clientHeight / 2 });
    syncing.current = false;
  }, [hoverIndex, km, ready]);

  /* ---------------------- position du cycliste (timeline) ---------------------- */
  useEffect(() => {
    let k: number | null = null;
    if (timelineTime != null && route && timing) {
      try {
        k = positionAtTime(route, timing, timelineTime).dist / 1000;
      } catch {
        k = null;
      }
    }
    markerKm.current = k;
    plot.current?.redraw(false);
  }, [timelineTime, route, timing, ready]);

  if (!route || points.length < 2) {
    return (
      <div data-testid="profile" className={cx('flex h-full flex-col gap-2 p-3', className)}>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="flex-1" />
      </div>
    );
  }

  /* --------------------------------- infobulle --------------------------------- */
  const u = plot.current;
  const i = hoverIndex != null && hoverIndex >= 0 && hoverIndex < points.length ? hoverIndex : null;
  let tip: React.ReactNode = null;
  if (u && i != null) {
    const p = points[i];
    const w = weather[i];
    const eta = timing?.etas[i];
    const x = u.valToPos(km[i], 'x') + u.over.offsetLeft;
    const width = box.current?.clientWidth ?? 0;
    const flip = x > width - 190;
    tip = (
      <div
        role="status"
        aria-live="polite"
        className="glass-strong pointer-events-none absolute top-1 z-10 w-[172px] rounded-2xl px-3 py-2 text-xs text-fg"
        style={{ left: flip ? x - 182 : x + 10 }}
      >
        <div className="tabular flex items-baseline justify-between font-semibold">
          <span>km {dec(p.dist / 1000)}</span>
          {eta != null && <span className="text-sky-500 dark:text-sky-300">{fmtTime(eta)}</span>}
        </div>
        <div className="tabular text-fg-subtle">
          {Math.round(p.ele)} m · pente {dec(p.grade)} %
        </div>
        {w && (
          <div className="mt-1.5 space-y-0.5 border-t border-line pt-1.5">
            <div className="tabular flex items-center gap-1.5">
              <WeatherIcon code={w.weatherCode} isDay={w.isDay} size={18} />
              <span className="font-semibold">{Math.round(w.temperature)}°</span>
              <span className="text-fg-subtle">ressenti {Math.round(w.apparentTemperature)}°</span>
            </div>
            <div className="tabular flex items-center gap-1">
              <WindArrow
                deg={w.windDirection}
                size={13}
                style={{ color: WIND_RELATION_COLORS[w.windRelation] }}
              />
              {Math.round(w.windSpeed)} km/h <span className="text-fg-subtle">{REL[w.windRelation]}</span>
            </div>
            <div className="tabular text-fg-subtle">
              Pluie {dec(w.precipitation)} mm · {Math.round(w.precipitationProbability)} %
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-testid="profile" className={cx('rc-profile flex h-full min-h-0 flex-col', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 pt-2.5 pb-1">
        <h2 className="text-[11px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">Profil</h2>
        <ul className="flex items-center gap-2.5 text-[10px] text-fg-subtle" aria-label="Légende des pentes">
          {GRADE_LEGEND.map((g) => (
            <li key={g.label} className="flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ background: g.color }} />
              {g.label}
            </li>
          ))}
        </ul>
        {overlay === 'wind' && weather.length > 0 && (
          <span className="text-[10px] text-fg-subtle">
            <span className="text-green-500">▲ dos</span> / <span className="text-red-500">▼ face</span>{' '}
            (km/h)
          </span>
        )}
        {overlay === 'rain' && weather.length > 0 && <span className="text-[10px] text-fg-subtle">mm/h</span>}
        <div className="ml-auto w-[230px]" data-export-ignore="">
          <Segmented
            label="Superposition sur le profil"
            value={overlay}
            options={OVERLAYS}
            onChange={setOverlay}
            size="sm"
          />
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={box}
          className="absolute inset-0"
          role="img"
          aria-label={`Profil d'altitude : ${dec(route.stats.distance / 1000)} km, de ${Math.round(route.stats.minEle)} à ${Math.round(route.stats.maxEle)} m`}
        />
        {tip}
        {ws === 'loading' && overlay !== 'none' && (
          <Skeleton className="pointer-events-none absolute inset-2 opacity-50" />
        )}
      </div>
    </div>
  );
}
