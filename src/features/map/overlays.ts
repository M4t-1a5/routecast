/**
 * Couches RouteCast ajoutées par-dessus le fond : champs météo (image), radar RainViewer,
 * trace colorée + casing + zone de survol, flèches de vent.
 * `install()` est idempotent et rappelé après chaque `style.load` (changement de fond / thème).
 * Les données sont conservées ici et poussées via `setData` / `updateImage`.
 */
import type { GeoJSONSource, ImageSource, LayerSpecification, Map as MlMap } from 'maplibre-gl';
import type { MapLayer } from '../../types';
import type { ArrowProps, FC, LineFeature, PointFeature, SegmentProps } from './geo';
import type { Corners } from './field';
import { RAINVIEWER_ATTRIBUTION } from './style';
import type { RainViewerFrames } from '../weather';

export const ID = {
  fieldTemp: 'rc-field-temp',
  fieldRain: 'rc-field-rain',
  radarPrefix: 'rc-radar-',
  routeLine: 'rc-route-line',
  routeSeg: 'rc-route-seg',
  casing: 'rc-route-casing',
  route: 'rc-route',
  hit: 'rc-route-hit',
  arrows: 'rc-arrows',
  arrowImg: 'rc-arrow',
} as const;

const EMPTY_FC: FC<never> = { type: 'FeatureCollection', features: [] };
const FIELD_OPACITY = { temperature: 0.45, rain: 0.75 } as const;
const RADAR_OPACITY = 0.7;
const FADE_MS = 400;

export interface FieldImage {
  url: string;
  coordinates: Corners;
}

/** Icône flèche (SDF, colorée via icon-color) dessinée en canvas. */
export function makeArrowImage(size = 48): ImageData | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const s = size / 48;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  // Flèche pointant vers le haut (nord) : icon-rotate = direction vers laquelle souffle le vent.
  ctx.moveTo(24 * s, 4 * s);
  ctx.lineTo(39 * s, 24 * s);
  ctx.lineTo(29 * s, 22 * s);
  ctx.lineTo(29 * s, 44 * s);
  ctx.lineTo(19 * s, 44 * s);
  ctx.lineTo(19 * s, 22 * s);
  ctx.lineTo(9 * s, 24 * s);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

export class Overlays {
  private segments: FC<LineFeature<SegmentProps>> = EMPTY_FC;
  private line: LineFeature<Record<string, never>> | FC<never> = EMPTY_FC;
  private arrows: FC<PointFeature<ArrowProps>> = EMPTY_FC;
  private fields: { temperature: FieldImage | null; rain: FieldImage | null } = {
    temperature: null,
    rain: null,
  };
  private radar: RainViewerFrames | null = null;
  private radarIndex = 0;
  private layer: MapLayer = 'wind';
  private radarActive = false;
  private hideTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private arrowImage: ImageData | null = null;

  constructor(
    private readonly map: MlMap,
    private reducedMotion: boolean,
  ) {}

  setReducedMotion(v: boolean) {
    this.reducedMotion = v;
  }

  /** Vrai entre un `style.load` et le prochain `setStyle` (géré par MapView). */
  ready = false;

  /** Premier calque symbole du fond (pour glisser les champs météo sous les libellés). */
  private firstBaseSymbol(): string | undefined {
    const layers = this.map.getStyle()?.layers ?? [];
    return layers.find((l) => l.type === 'symbol' && !l.id.startsWith('rc-'))?.id;
  }

  private transition() {
    return { duration: this.reducedMotion ? 0 : FADE_MS, delay: 0 };
  }

  /** (Ré)installe toutes les sources / couches. Idempotent. */
  install() {
    const m = this.map;
    if (!m.style) return;
    this.ready = true;
    if (!m.hasImage(ID.arrowImg)) {
      this.arrowImage ??= makeArrowImage();
      if (this.arrowImage) m.addImage(ID.arrowImg, this.arrowImage, { sdf: true, pixelRatio: 2 });
    }
    const before = this.firstBaseSymbol();

    // Champs météo (image), sous les libellés.
    for (const kind of ['temperature', 'rain'] as const) this.installField(kind, before);
    // Radar
    this.installRadar(before);

    // Trace
    if (!m.getSource(ID.routeLine)) m.addSource(ID.routeLine, { type: 'geojson', data: this.line as never });
    if (!m.getSource(ID.routeSeg))
      m.addSource(ID.routeSeg, { type: 'geojson', data: this.segments as never });
    if (!m.getSource(ID.arrows)) m.addSource(ID.arrows, { type: 'geojson', data: this.arrows as never });

    this.addLayer({
      id: ID.casing,
      type: 'line',
      source: ID.routeLine,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#0b1020',
        'line-opacity': 0.6,
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 5, 12, 9, 16, 14],
        'line-blur': 1,
      },
    });
    this.addLayer({
      id: ID.route,
      type: 'line',
      source: ID.routeSeg,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2.5, 12, 5, 16, 8],
        'line-opacity-transition': { duration: 120, delay: 0 },
      },
    });
    this.addLayer({
      id: ID.hit,
      type: 'line',
      source: ID.routeLine,
      paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 24 },
    });
    this.addLayer({
      id: ID.arrows,
      type: 'symbol',
      source: ID.arrows,
      layout: {
        'icon-image': ID.arrowImg,
        'icon-rotate': ['get', 'rotate'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['get', 'speed'], 0, 0.8, 20, 1.05, 50, 1.4, 90, 1.7],
      },
      paint: {
        'icon-color': ['get', 'color'],
        'icon-halo-color': 'rgba(8,12,28,0.85)',
        'icon-halo-width': 1.5,
        'icon-opacity': this.layer === 'wind' ? 1 : 0,
        'icon-opacity-transition': this.transition(),
      },
    });
    this.applyVisibility(true);
  }

  private addLayer(spec: LayerSpecification, before?: string) {
    if (this.map.getLayer(spec.id)) return;
    this.map.addLayer(spec, before && this.map.getLayer(before) ? before : undefined);
  }

  private installField(kind: 'temperature' | 'rain', before?: string) {
    const id = kind === 'temperature' ? ID.fieldTemp : ID.fieldRain;
    const img = this.fields[kind];
    const m = this.map;
    if (!img) {
      if (m.getLayer(id)) m.removeLayer(id);
      if (m.getSource(id)) m.removeSource(id);
      return;
    }
    if (!m.getSource(id)) m.addSource(id, { type: 'image', url: img.url, coordinates: img.coordinates });
    this.addLayer(
      {
        id,
        type: 'raster',
        source: id,
        paint: {
          'raster-opacity': 0,
          'raster-opacity-transition': this.transition(),
          'raster-fade-duration': 0,
          'raster-resampling': 'linear',
        },
      },
      before ?? this.firstRouteLayer(),
    );
  }

  private firstRouteLayer(): string | undefined {
    return [ID.casing, ID.route, ID.hit, ID.arrows].find((l) => this.map.getLayer(l));
  }

  private radarIds(): string[] {
    return (this.radar?.frames ?? []).map((_, i) => `${ID.radarPrefix}${i}`);
  }

  private removeRadarLayers() {
    const m = this.map;
    const layers = m.getStyle()?.layers ?? [];
    for (const l of layers) if (l.id.startsWith(ID.radarPrefix)) m.removeLayer(l.id);
    for (const id of Object.keys(m.getStyle()?.sources ?? {}))
      if (id.startsWith(ID.radarPrefix)) m.removeSource(id);
  }

  private installRadar(before?: string) {
    const r = this.radar;
    if (!r) return;
    const m = this.map;
    r.frames.forEach((f, i) => {
      const id = `${ID.radarPrefix}${i}`;
      if (!m.getSource(id))
        m.addSource(id, {
          type: 'raster',
          tiles: [`${r.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`],
          tileSize: 256,
          maxzoom: 7,
          attribution: RAINVIEWER_ATTRIBUTION,
        });
      this.addLayer(
        {
          id,
          type: 'raster',
          source: id,
          layout: { visibility: 'none' },
          paint: {
            'raster-opacity': 0,
            'raster-opacity-transition': { duration: this.reducedMotion ? 0 : 250, delay: 0 },
            'raster-fade-duration': 0,
          },
        },
        before ?? this.firstRouteLayer(),
      );
    });
  }

  /* --------------------------- Données --------------------------- */

  setRoute(line: LineFeature<Record<string, never>> | null, segments: FC<LineFeature<SegmentProps>>) {
    this.line = line ?? EMPTY_FC;
    this.segments = segments;
    (this.map.getSource(ID.routeLine) as GeoJSONSource | undefined)?.setData(this.line as never);
    (this.map.getSource(ID.routeSeg) as GeoJSONSource | undefined)?.setData(this.segments as never);
  }

  setSegments(segments: FC<LineFeature<SegmentProps>>) {
    this.segments = segments;
    (this.map.getSource(ID.routeSeg) as GeoJSONSource | undefined)?.setData(segments as never);
  }

  setArrows(arrows: FC<PointFeature<ArrowProps>>) {
    this.arrows = arrows;
    (this.map.getSource(ID.arrows) as GeoJSONSource | undefined)?.setData(arrows as never);
  }

  setField(kind: 'temperature' | 'rain', img: FieldImage | null) {
    const prev = this.fields[kind];
    this.fields[kind] = img;
    if (!this.ready) return;
    const id = kind === 'temperature' ? ID.fieldTemp : ID.fieldRain;
    const src = this.map.getSource(id) as ImageSource | undefined;
    if (img && src && prev) {
      src.updateImage({ url: img.url, coordinates: img.coordinates });
    } else {
      this.installField(kind, this.firstBaseSymbol());
    }
    this.applyVisibility();
  }

  setRadar(frames: RainViewerFrames | null) {
    if (this.ready) this.removeRadarLayers();
    this.radar = frames && frames.frames.length ? frames : null;
    this.radarIndex = this.radar ? this.defaultRadarIndex() : 0;
    if (this.ready) {
      this.installRadar(this.firstBaseSymbol());
      this.applyVisibility();
    }
  }

  /** Dernière frame observée (avant le nowcast). */
  defaultRadarIndex(): number {
    const frames = this.radar?.frames ?? [];
    let idx = frames.length - 1;
    for (let i = 0; i < frames.length; i++) if (frames[i].kind === 'past') idx = i;
    return Math.max(0, idx);
  }

  setRadarFrame(i: number) {
    this.radarIndex = i;
    this.applyVisibility();
  }

  setMode(layer: MapLayer, radarActive: boolean) {
    this.layer = layer;
    this.radarActive = radarActive;
    this.applyVisibility();
  }

  setRouteOpacity(o: number) {
    if (this.map.getLayer(ID.route)) this.map.setPaintProperty(ID.route, 'line-opacity', o);
  }

  /* ------------------------- Visibilité -------------------------- */

  private fade(id: string, prop: 'raster-opacity' | 'icon-opacity', target: number, immediate = false) {
    const m = this.map;
    if (!m.getLayer(id)) return;
    const timer = this.hideTimers.get(id);
    if (timer) clearTimeout(timer);
    this.hideTimers.delete(id);
    if (target > 0) {
      if (m.getLayoutProperty(id, 'visibility') === 'none') m.setLayoutProperty(id, 'visibility', 'visible');
      m.setPaintProperty(id, prop, target);
    } else {
      m.setPaintProperty(id, prop, 0);
      const hide = () => {
        if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none');
      };
      if (immediate || this.reducedMotion) hide();
      else this.hideTimers.set(id, setTimeout(hide, FADE_MS + 50));
    }
  }

  private applyVisibility(immediate = false) {
    if (!this.ready) return;
    const L = this.layer;
    this.fade(ID.fieldTemp, 'raster-opacity', L === 'temperature' ? FIELD_OPACITY.temperature : 0, immediate);
    this.fade(
      ID.fieldRain,
      'raster-opacity',
      L === 'rain' && !this.radarActive ? FIELD_OPACITY.rain : 0,
      immediate,
    );
    const showRadar = L === 'rain' && this.radarActive;
    this.radarIds().forEach((id, i) => {
      const m = this.map;
      if (!m.getLayer(id)) return;
      if (showRadar) {
        // Toutes les frames visibles (préchargement des tuiles), une seule opaque : pas de clignotement.
        if (m.getLayoutProperty(id, 'visibility') === 'none')
          m.setLayoutProperty(id, 'visibility', 'visible');
        m.setPaintProperty(id, 'raster-opacity', i === this.radarIndex ? RADAR_OPACITY : 0);
      } else {
        m.setPaintProperty(id, 'raster-opacity', 0);
        m.setLayoutProperty(id, 'visibility', 'none');
      }
    });
    if (this.map.getLayer(ID.arrows))
      this.map.setPaintProperty(ID.arrows, 'icon-opacity', L === 'wind' ? 1 : 0);
  }

  destroy() {
    for (const t of this.hideTimers.values()) clearTimeout(t);
    this.hideTimers.clear();
  }
}
