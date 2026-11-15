/**
 * Champ de particules de vent animé (canvas 2D superposé à la carte, façon Windy / Apple Météo).
 * Le champ écran (ScreenWindField) est pré-calculé par l'appelant à chaque changement de vue / temps.
 */
import { WIND_STOPS, ramp, rampRgb } from '../../lib/colors';
import { type ScreenWindField, windAtPixel } from './field';

/** Nombre de classes de couleur (dessin groupé par couleur = peu de changements d'état canvas). */
const BUCKETS = [0, 5, 10, 15, 20, 30, 40, 50, 60, 80, 100];
const BUCKET_COLORS = BUCKETS.map((v) => ramp(WIND_STOPS, v + 2.5));
/** Fond clair : couleurs assombries pour rester lisibles. */
const BUCKET_COLORS_LIGHT = BUCKETS.map((v) => {
  const [r, g, b] = rampRgb(WIND_STOPS, v + 2.5);
  const k = 0.55;
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
});
/** px / frame par km/h. */
const SPEED_FACTOR = 0.022;
const MAX_AGE = 200;

function bucketOf(speed: number): number {
  let b = 0;
  while (b < BUCKETS.length - 1 && speed >= BUCKETS[b + 1]) b++;
  return b;
}

export class WindParticles {
  private ctx: CanvasRenderingContext2D | null;
  private field: ScreenWindField | null = null;
  private xs: Float32Array;
  private ys: Float32Array;
  private ages: Uint16Array;
  private raf = 0;
  private running = false;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private readonly count: number;
  private colors = BUCKET_COLORS;
  private readonly onVisibility = () => {
    if (document.hidden) this.cancelFrame();
    else if (this.running) this.loop();
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    count: number,
  ) {
    this.ctx = canvas.getContext('2d');
    this.count = count;
    this.xs = new Float32Array(count);
    this.ys = new Float32Array(count);
    this.ages = new Uint16Array(count);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Adapte la taille du canvas (CSS px) au conteneur. */
  resize(width: number, height: number) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = width;
    this.h = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Palette adaptée au fond (sombre par défaut). */
  setDark(dark: boolean) {
    this.colors = dark ? BUCKET_COLORS : BUCKET_COLORS_LIGHT;
  }

  setField(field: ScreenWindField | null) {
    this.field = field;
    this.clear();
    if (field) for (let i = 0; i < this.count; i++) this.respawn(i, true);
  }

  clear() {
    this.ctx?.clearRect(0, 0, this.w, this.h);
  }

  start() {
    if (this.running) return;
    this.running = true;
    if (!document.hidden) this.loop();
  }

  stop() {
    this.running = false;
    this.cancelFrame();
  }

  destroy() {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.clear();
    this.field = null;
  }

  private cancelFrame() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private respawn(i: number, randomAge = false) {
    this.xs[i] = Math.random() * this.w;
    this.ys[i] = Math.random() * this.h;
    this.ages[i] = randomAge ? Math.floor(Math.random() * MAX_AGE) : 0;
  }

  private loop = () => {
    this.cancelFrame();
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (!this.running) return;
      this.frame();
      this.loop();
    });
  };

  private frame() {
    const ctx = this.ctx;
    const f = this.field;
    if (!ctx || !f) return;
    // Estompe les traînées : on réduit l'alpha de ce qui est déjà dessiné.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = 'rgba(0,0,0,0.94)';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'source-over';

    const paths = BUCKETS.map(() => new Path2D());
    const used = new Uint8Array(BUCKETS.length);
    for (let i = 0; i < this.count; i++) {
      const x = this.xs[i],
        y = this.ys[i];
      const wv = this.ages[i] > MAX_AGE ? null : windAtPixel(f, x, y);
      if (!wv) {
        this.respawn(i);
        continue;
      }
      const speed = Math.hypot(wv.u, wv.v);
      const nx = x + wv.u * SPEED_FACTOR;
      const ny = y + wv.v * SPEED_FACTOR;
      const b = bucketOf(speed);
      paths[b].moveTo(x, y);
      paths[b].lineTo(nx, ny);
      used[b] = 1;
      this.xs[i] = nx;
      this.ys[i] = ny;
      this.ages[i]++;
      if (nx < 0 || ny < 0 || nx > this.w || ny > this.h) this.respawn(i);
    }
    ctx.lineWidth = 1.25;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.8;
    for (let b = 0; b < BUCKETS.length; b++) {
      if (!used[b]) continue;
      ctx.strokeStyle = this.colors[b];
      ctx.stroke(paths[b]);
    }
    ctx.globalAlpha = 1;
  }
}

/** Nombre de particules selon la surface (moins sur mobile). */
export function particleCount(width: number, height: number): number {
  const area = width * height;
  if (width < 768) return Math.round(Math.min(1200, Math.max(500, area / 400)));
  return Math.round(Math.min(2500, Math.max(1200, area / 800)));
}
