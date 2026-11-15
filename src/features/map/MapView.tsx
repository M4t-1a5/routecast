// OWNER: agent Carte. Composant plein écran, lit le store (useApp). Aucune prop requise.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Map as MlMap, Marker, setWorkerUrl, type MapLayerMouseEvent } from 'maplibre-gl';
// MapLibre v6 (ESM) : le worker est un fichier autonome, résolu ici pour Vite (dev + build).
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useApp } from '../../store/useApp';
import { positionAtTime, routeBounds } from '../route';
import { fetchRainViewerFrames, type RainViewerFrames } from '../weather';
import { PRECIP_STOPS, TEMP_STOPS } from '../../lib/colors';
import { cardinal, fmtKm, fmtM, fmtTemp, fmtTime, fmtWind } from '../../lib/format';
import type { Route } from '../../types';
import {
  buildColoredSegments,
  buildRouteLine,
  buildWindArrows,
  isLoop,
  isRadarWindow,
  nearestIndex,
  pointsBounds,
  positionFromEtas,
  recenterPadding,
} from './geo';
import {
  buildScreenWindField,
  makeWindSampler,
  precipAlpha,
  precipValue,
  renderFieldImage,
  tempValue,
} from './field';
import { ID, Overlays } from './overlays';
import { WindParticles, particleCount } from './particles';
import { fallbackStyle, resolveStyle } from './style';
import { registerMap } from './mapInstance';
import { glass, prefersReducedMotion } from './ui';
import MapLayerSwitcher from './MapLayerSwitcher';
import MapControls from './MapControls';
import MapLegend from './MapLegend';
import RadarPlayer from './RadarPlayer';

setWorkerUrl(maplibreWorkerUrl);

const RELATION_LABEL = { head: 'de face', tail: 'de dos', cross: 'de travers' } as const;

function useReducedMotion(): boolean {
  const [v, setV] = useState(prefersReducedMotion);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setV(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return v;
}

/** Horloge à la minute (fenêtre radar). */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function boundsOf(route: Route): [number, number, number, number] {
  const b = routeBounds(route);
  return b[0] === b[2] && b[1] === b[3] ? pointsBounds(route.points) : b;
}

function markerEl(className: string, html = ''): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = html;
  return el;
}

const FLAG_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><defs><pattern id="rc-chk" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="3" height="3" fill="#111"/><rect x="3" y="3" width="3" height="3" fill="#111"/><rect x="3" width="3" height="3" fill="#fff"/><rect y="3" width="3" height="3" fill="#fff"/></pattern></defs><rect x="3" y="3" width="18" height="18" rx="3" fill="url(#rc-chk)"/></svg>';

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const overlaysRef = useRef<Overlays | null>(null);
  const particlesRef = useRef<WindParticles | null>(null);
  const particleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const route = useApp((s) => s.route);
  const weather = useApp((s) => s.weather);
  const timing = useApp((s) => s.timing);
  const grid = useApp((s) => s.grid);
  const layer = useApp((s) => s.layer);
  const baseMap = useApp((s) => s.baseMap);
  const theme = useApp((s) => s.theme);
  const hoverIndex = useApp((s) => s.hoverIndex);
  const timelineTime = useApp((s) => s.timelineTime);
  const startTime = useApp((s) => s.settings.startTime);
  const tz = useApp((s) => s.settings.timezone);
  const recenterTick = useApp((s) => s.recenterTick);
  const reducedMotion = useReducedMotion();
  const now = useMinuteClock();
  const time = timelineTime ?? startTime;

  /* ------------------------- Création de la carte ------------------------- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new MlMap({
      container,
      style: fallbackStyle(useApp.getState().theme),
      center: [2.35, 48.85],
      zoom: 5,
      attributionControl: { compact: true },
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
      maxPitch: 0,
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: 150,
    });
    const overlays = new Overlays(map, prefersReducedMotion());

    // Canvas des particules : inséré juste après le canvas WebGL (sous les marqueurs DOM).
    const pc = document.createElement('canvas');
    pc.className = 'rc-particles';
    Object.assign(pc.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 400ms ease',
      mixBlendMode: useApp.getState().theme === 'dark' ? 'screen' : 'normal',
    } satisfies Partial<CSSStyleDeclaration>);
    pc.setAttribute('aria-hidden', 'true');
    map.getCanvas().after(pc);
    particleCanvasRef.current = pc;

    map.on('style.load', () => overlays.install());

    // Survol de la trace → hoverIndex (plus proche point en pixels).
    let projected: Float32Array | null = null;
    let projectedFor: Route | null = null;
    let pending = 0;
    const invalidate = () => (projected = null);
    map.on('move', invalidate);
    map.on('resize', invalidate);
    const pick = (x: number, y: number) => {
      const r = useApp.getState().route;
      if (!r) return;
      if (!projected || projectedFor !== r) {
        projected = new Float32Array(r.points.length * 2);
        r.points.forEach((p, i) => {
          const q = map.project([p.lon, p.lat]);
          projected![i * 2] = q.x;
          projected![i * 2 + 1] = q.y;
        });
        projectedFor = r;
      }
      const idx = nearestIndex(projected, x, y, 40);
      if (idx >= 0 && idx !== useApp.getState().hoverIndex) useApp.getState().setHoverIndex(idx);
    };
    const onMove = (e: MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = 'pointer';
      const { x, y } = e.point;
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => pick(x, y));
    };
    const onLeave = () => {
      cancelAnimationFrame(pending);
      map.getCanvas().style.cursor = '';
      useApp.getState().setHoverIndex(null);
    };
    const onClick = (e: MapLayerMouseEvent) => pick(e.point.x, e.point.y);
    map.on('mousemove', ID.hit, onMove);
    map.on('mouseleave', ID.hit, onLeave);
    map.on('click', ID.hit, onClick);

    mapRef.current = map;
    overlaysRef.current = overlays;
    registerMap(map, pc);
    setMapReady(true);

    return () => {
      cancelAnimationFrame(pending);
      registerMap(null);
      particlesRef.current?.destroy();
      particlesRef.current = null;
      particleCanvasRef.current = null;
      overlays.destroy();
      map.remove();
      pc.remove();
      mapRef.current = null;
      overlaysRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => overlaysRef.current?.setReducedMotion(reducedMotion), [reducedMotion, mapReady]);

  /* ------------------------------- Fond --------------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    const overlays = overlaysRef.current;
    if (!map || !overlays) return;
    const ac = new AbortController();
    resolveStyle(theme, baseMap, ac.signal)
      .then((style) => {
        if (ac.signal.aborted) return;
        overlays.ready = false;
        map.setStyle(style, { diff: false });
      })
      .catch(() => undefined);
    if (particleCanvasRef.current)
      particleCanvasRef.current.style.mixBlendMode = theme === 'dark' ? 'screen' : 'normal';
    return () => ac.abort();
  }, [theme, baseMap, mapReady]);

  /* ------------------------------- Trace -------------------------------- */
  const line = useMemo(() => (route ? buildRouteLine(route) : null), [route]);
  const segments = useMemo(
    () =>
      route
        ? buildColoredSegments(route, weather, layer)
        : { type: 'FeatureCollection' as const, features: [] },
    [route, weather, layer],
  );
  const arrows = useMemo(
    () => (route ? buildWindArrows(route, weather) : { type: 'FeatureCollection' as const, features: [] }),
    [route, weather],
  );
  useEffect(() => {
    overlaysRef.current?.setRoute(line, segments);
  }, [line, segments, mapReady]);
  useEffect(() => {
    overlaysRef.current?.setArrows(arrows);
  }, [arrows, mapReady]);

  // Pulsation discrète pendant le chargement de la météo.
  const loadingWeather = !!route && weather.length === 0;
  useEffect(() => {
    const overlays = overlaysRef.current;
    if (!overlays) return;
    if (!loadingWeather) {
      overlays.setRouteOpacity(1);
      return;
    }
    if (reducedMotion) {
      overlays.setRouteOpacity(0.75);
      return;
    }
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 80) {
        last = t;
        overlays.setRouteOpacity(0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t / 380)));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      overlays.setRouteOpacity(1);
    };
  }, [loadingWeather, reducedMotion, mapReady]);

  /* ------------------------------ Radar --------------------------------- */
  const radarWindow = layer === 'rain' && isRadarWindow(startTime, now);
  const [radar, setRadar] = useState<RainViewerFrames | null>(null);
  const [radarIndex, setRadarIndex] = useState(0);
  const [radarPlaying, setRadarPlaying] = useState(false);
  const radarLoadedAt = useRef(0);
  useEffect(() => {
    if (!radarWindow || !mapReady) return;
    if (radar && Date.now() - radarLoadedAt.current < 10 * 60_000) return;
    let cancelled = false;
    fetchRainViewerFrames()
      .then((f) => {
        if (cancelled) return;
        radarLoadedAt.current = Date.now();
        const ok = f.frames.length ? f : null;
        overlaysRef.current?.setRadar(ok);
        setRadar(ok);
        setRadarIndex(overlaysRef.current?.defaultRadarIndex() ?? 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [radarWindow, mapReady, radar, now]);
  const radarActive = radarWindow && !!radar;
  useEffect(() => {
    overlaysRef.current?.setRadarFrame(radarIndex);
  }, [radarIndex, radar]);
  useEffect(() => {
    overlaysRef.current?.setMode(layer, radarActive);
  }, [layer, radarActive, mapReady]);
  const onRadarIndex = useCallback((i: number) => setRadarIndex(i), []);

  /* ------------------------ Champs pluie / température ------------------------ */
  useEffect(() => {
    const overlays = overlaysRef.current;
    if (!overlays) return;
    if (!grid) {
      overlays.setField('temperature', null);
      overlays.setField('rain', null);
      return;
    }
    if (layer === 'wind' || (layer === 'rain' && radarActive)) return;
    // Coalescence (timeline en lecture) : au plus une image par frame.
    const raf = requestAnimationFrame(() => {
      if (layer === 'temperature')
        overlays.setField(
          'temperature',
          renderFieldImage(grid, time, tempValue, TEMP_STOPS, { edgeFeather: 0.3 }),
        );
      else
        overlays.setField(
          'rain',
          renderFieldImage(grid, time, precipValue, PRECIP_STOPS, {
            minValue: 0.1,
            alpha: precipAlpha,
            edgeFeather: 0.25,
          }),
        );
    });
    return () => cancelAnimationFrame(raf);
  }, [grid, time, layer, radarActive, mapReady]);

  /* ------------------------- Particules de vent ------------------------- */
  const particlesOn = layer === 'wind' && !!grid && !reducedMotion && mapReady;
  useEffect(() => {
    const map = mapRef.current;
    const canvas = particleCanvasRef.current;
    if (!map || !canvas) return;
    if (!particlesOn || !grid) {
      canvas.style.opacity = '0';
      const p = particlesRef.current;
      const t = setTimeout(() => p?.stop(), 450);
      return () => clearTimeout(t);
    }
    const container = map.getContainer();
    let p = particlesRef.current;
    if (!p) {
      p = new WindParticles(canvas, particleCount(container.clientWidth, container.clientHeight));
      particlesRef.current = p;
    }
    p.setDark(theme === 'dark');
    const sampler = makeWindSampler(grid, time);
    const [w, s, e, n] = grid.bbox;
    const mw = (e - w) * 0.08,
      mh = (n - s) * 0.08;
    const parts = p;
    const rebuild = () => {
      const width = container.clientWidth,
        height = container.clientHeight;
      parts.resize(width, height);
      const field = buildScreenWindField(
        width,
        height,
        20,
        (x, y) => {
          const ll = map.unproject([x, y]);
          if (ll.lng < w - mw || ll.lng > e + mw || ll.lat < s - mh || ll.lat > n + mh) return null;
          return sampler(ll.lat, ll.lng);
        },
        map.getBearing(),
      );
      parts.setField(field);
      parts.start();
    };
    const onMoveStart = () => {
      parts.stop();
      parts.clear();
    };
    const onMoveEnd = () => rebuild();
    map.on('movestart', onMoveStart);
    map.on('move', onMoveStart);
    map.on('moveend', onMoveEnd);
    map.on('resize', onMoveEnd);
    rebuild();
    canvas.style.opacity = '1';
    return () => {
      map.off('movestart', onMoveStart);
      map.off('move', onMoveStart);
      map.off('moveend', onMoveEnd);
      map.off('resize', onMoveEnd);
    };
  }, [particlesOn, grid, time, theme]);

  /* ----------------------------- Recentrage ----------------------------- */
  const routeId = route?.id;
  useEffect(() => {
    const map = mapRef.current;
    const r = useApp.getState().route;
    if (!map || !r || r.points.length < 2) return;
    const [w, s, e, n] = boundsOf(r);
    const c = map.getContainer();
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      {
        padding: recenterPadding(c.clientWidth, c.clientHeight),
        duration: prefersReducedMotion() ? 0 : 900,
        maxZoom: 15,
      },
    );
  }, [routeId, recenterTick, mapReady]);

  /* ------------------------------ Marqueurs ------------------------------ */
  // Départ / arrivée
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route || route.points.length < 2) return;
    const first = route.points[0];
    const last = route.points[route.points.length - 1];
    const markers: Marker[] = [];
    const pill =
      'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-lg ring-2 ring-white/90';
    if (isLoop(route)) {
      const el = markerEl(`${pill} bg-emerald-500 text-white`, `${FLAG_SVG}<span>Départ · Arrivée</span>`);
      el.setAttribute('aria-label', 'Départ et arrivée (boucle)');
      markers.push(
        new Marker({ element: el, anchor: 'bottom', offset: [0, -6] })
          .setLngLat([first.lon, first.lat])
          .addTo(map),
      );
    } else {
      const s = markerEl(
        `${pill} bg-emerald-500 text-white`,
        '<span class="h-2 w-2 rounded-full bg-white"></span><span>Départ</span>',
      );
      s.setAttribute('aria-label', 'Départ');
      const f = markerEl(`${pill} bg-rose-500 text-white`, `${FLAG_SVG}<span>Arrivée</span>`);
      f.setAttribute('aria-label', 'Arrivée');
      markers.push(
        new Marker({ element: s, anchor: 'bottom', offset: [0, -6] })
          .setLngLat([first.lon, first.lat])
          .addTo(map),
      );
      markers.push(
        new Marker({ element: f, anchor: 'bottom', offset: [0, -6] })
          .setLngLat([last.lon, last.lat])
          .addTo(map),
      );
    }
    // Sommets des montées
    for (const c of route.climbs) {
      const p = route.points[c.endIdx];
      if (!p) continue;
      const cat = c.category === 'HC' ? 'HC' : `Cat. ${c.category}`;
      const el = markerEl(
        'group relative cursor-default',
        `<svg viewBox="0 0 16 14" width="14" height="12" aria-hidden="true" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))"><path d="M8 1 15 13H1Z" fill="#f97316" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>` +
          `<span class="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-black/80 px-2 py-1 text-[11px] text-white shadow group-hover:block">${cat} · ${fmtM(c.summitEle)} · ${c.avgGrade.toFixed(1)} %</span>`,
      );
      el.setAttribute('aria-label', `Sommet ${cat}, ${fmtM(c.summitEle)}`);
      el.title = `${cat} – ${fmtM(c.summitEle)}`;
      markers.push(new Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(map));
    }
    return () => markers.forEach((m) => m.remove());
  }, [route, mapReady]);

  // Marqueur synchronisé (survol) + mini-carte info, et marqueur cycliste : contenus rendus en portail.
  const [hoverEl] = useState(() => markerEl('pointer-events-none'));
  const [riderEl] = useState(() => markerEl('pointer-events-none'));
  const hoverMarker = useRef<Marker | null>(null);
  const riderMarker = useRef<Marker | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    hoverMarker.current = new Marker({ element: hoverEl, anchor: 'center' });
    riderMarker.current = new Marker({ element: riderEl, anchor: 'center', rotationAlignment: 'map' });
    return () => {
      hoverMarker.current?.remove();
      riderMarker.current?.remove();
      hoverMarker.current = riderMarker.current = null;
    };
  }, [mapReady, hoverEl, riderEl]);

  const hoverPoint = route && hoverIndex !== null ? route.points[hoverIndex] : undefined;
  useEffect(() => {
    const map = mapRef.current;
    const m = hoverMarker.current;
    if (!map || !m) return;
    if (hoverPoint) m.setLngLat([hoverPoint.lon, hoverPoint.lat]).addTo(map);
    else m.remove();
  }, [hoverPoint, mapReady]);

  const rider = useMemo(() => {
    if (!route || !timing || timelineTime === null) return null;
    let pos = positionAtTime(route, timing, timelineTime);
    if (pos.lat === 0 && pos.lon === 0) pos = positionFromEtas(route, timing, timelineTime);
    return { ...pos, bearing: route.points[pos.index]?.bearing ?? 0 };
  }, [route, timing, timelineTime]);
  useEffect(() => {
    const map = mapRef.current;
    const m = riderMarker.current;
    if (!map || !m) return;
    if (rider) m.setLngLat([rider.lon, rider.lat]).setRotation(rider.bearing).addTo(map);
    else m.remove();
  }, [rider, mapReady]);

  const hoverWeather =
    hoverIndex !== null
      ? (weather.find((w) => w.routeIndex === hoverIndex) ?? weather[hoverIndex])
      : undefined;
  const hoverEta = hoverIndex !== null ? timing?.etas[hoverIndex] : undefined;

  const rainMode = radarActive ? 'radar' : 'forecast';

  return (
    <div
      className={`absolute inset-0 overflow-hidden ${theme === 'dark' ? 'bg-[#0b1020]' : 'bg-slate-200'} [&_.maplibregl-ctrl-bottom-right]:mb-[46vh] lg:[&_.maplibregl-ctrl-bottom-right]:mb-[292px]`}
      data-testid="map"
    >
      {/* MapLibre impose position:relative (CSS non-layered) sur son conteneur : on l'enveloppe. */}
      <div className="absolute inset-0">
        <div ref={containerRef} className="h-full w-full" aria-label="Carte de la trace" role="region" />
      </div>

      {/* Contrôles flottants : haut (mobile), haut droite (desktop) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 p-3 pt-[max(env(safe-area-inset-top),0.75rem)] lg:left-auto lg:w-[340px] lg:p-4">
        <MapLayerSwitcher />
        <div className="flex items-start justify-end gap-2">
          <div className="flex min-w-0 max-w-[17rem] flex-1 flex-col gap-2">
            <MapLegend layer={layer} rainMode={rainMode} />
            {layer === 'rain' && radarActive && radar && (
              <RadarPlayer
                frames={radar.frames}
                index={radarIndex}
                onIndex={onRadarIndex}
                playing={radarPlaying}
                onPlaying={setRadarPlaying}
              />
            )}
          </div>
          <MapControls />
        </div>
      </div>

      {createPortal(
        hoverPoint ? (
          <div className="relative">
            <div className="h-3.5 w-3.5 rounded-full bg-white shadow-[0_0_0_4px_rgba(255,255,255,0.35),0_0_14px_4px_rgba(255,255,255,0.65)]" />
            <div
              className={`${glass(theme)} absolute bottom-6 left-1/2 w-max -translate-x-1/2 px-3 py-2 text-xs leading-snug`}
              role="status"
            >
              <div className="font-semibold tabular-nums">
                {fmtKm(hoverPoint.dist)} · {fmtM(hoverPoint.ele)}
                {hoverEta !== undefined && (
                  <span className="font-normal opacity-75"> · {fmtTime(hoverEta, tz)}</span>
                )}
              </div>
              {hoverWeather && (
                <div className="tabular-nums opacity-90">
                  {fmtTemp(hoverWeather.temperature)} · {fmtWind(hoverWeather.windSpeed)}{' '}
                  {cardinal(hoverWeather.windDirection)}{' '}
                  <span className="opacity-75">({RELATION_LABEL[hoverWeather.windRelation]})</span>
                </div>
              )}
            </div>
          </div>
        ) : null,
        hoverEl,
      )}
      {createPortal(
        rider ? (
          <div
            className="grid h-8 w-8 place-items-center rounded-full bg-sky-500 text-white shadow-[0_0_0_3px_rgba(255,255,255,0.95),0_4px_12px_rgba(0,0,0,0.45)]"
            aria-label="Position du cycliste"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M12 3 19 19l-7-3.5L5 19Z" />
            </svg>
          </div>
        ) : null,
        riderEl,
      )}
    </div>
  );
}
