// Génère public/demo/houilles-chevreuse.gpx (boucle de démo) et les icônes PWA.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = [
  [48.9262, 2.1893, 38],
  [48.9165, 2.182, 32],
  [48.905, 2.17, 30],
  [48.889, 2.158, 31],
  [48.88, 2.144, 33],
  [48.887, 2.118, 30],
  [48.893, 2.106, 32],
  [48.898, 2.093, 78],
  [48.89, 2.076, 88],
  [48.881, 2.06, 95],
  [48.868, 2.04, 112],
  [48.857, 2.021, 122],
  [48.847, 2.048, 128],
  [48.845, 2.065, 131],
  [48.84, 2.076, 124],
  [48.826, 2.09, 128],
  [48.815, 2.105, 136],
  [48.805, 2.085, 132],
  [48.8, 2.063, 130],
  [48.786, 2.069, 152],
  [48.773, 2.074, 165],
  [48.758, 2.05, 166],
  [48.74, 2.063, 161],
  [48.725, 2.07, 120],
  [48.706, 2.072, 70],
  [48.707, 2.055, 73],
  [48.707, 2.039, 76],
  [48.7, 2.03, 120],
  [48.695, 2.02, 165],
  [48.699, 2.002, 140],
  [48.705, 1.985, 96],
  [48.708, 1.965, 118],
  [48.712, 1.93, 158],
  [48.716, 1.894, 170],
  [48.73, 1.92, 172],
  [48.743, 1.957, 170],
  [48.765, 1.96, 168],
  [48.784, 1.955, 175],
  [48.805, 1.98, 140],
  [48.828, 2.003, 110],
  [48.853, 1.987, 112],
  [48.872, 1.976, 121],
  [48.89, 2.01, 95],
  [48.905, 2.04, 82],
  [48.92, 2.065, 78],
  [48.935, 2.1, 45],
  [48.947, 2.145, 36],
  [48.94, 2.165, 35],
  [48.932, 2.18, 37],
  [48.9262, 2.1893, 38],
];
const R = 6371000,
  rad = Math.PI / 180;
const hav = (a, b) => {
  const dl = (b[0] - a[0]) * rad,
    dn = (b[1] - a[1]) * rad;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const cr = (p0, p1, p2, p3, t) =>
  0.5 *
  (2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
let seed = 42;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pts = [];
for (let i = 0; i < W.length - 1; i++) {
  const p0 = W[Math.max(0, i - 1)],
    p1 = W[i],
    p2 = W[i + 1],
    p3 = W[Math.min(W.length - 1, i + 2)];
  const n = Math.max(2, Math.round(hav(p1, p2) / 25));
  for (let k = 0; k < n; k++) {
    const t = k / n;
    const lat = cr(p0[0], p1[0], p2[0], p3[0], t),
      lon = cr(p0[1], p1[1], p2[1], p3[1], t);
    const e = p1[2] + ((p2[2] - p1[2]) * (1 - Math.cos(Math.PI * t))) / 2 + (rnd() - 0.5) * 3;
    pts.push([lat, lon, e]);
  }
}
pts.push(W[W.length - 1]);
let d = 0;
for (let i = 1; i < pts.length; i++) d += hav(pts[i - 1], pts[i]);
const body = pts
  .map(
    ([la, lo, e]) =>
      `      <trkpt lat="${la.toFixed(6)}" lon="${lo.toFixed(6)}"><ele>${e.toFixed(1)}</ele></trkpt>`,
  )
  .join('\n');
writeFileSync(
  'public/demo/houilles-chevreuse.gpx',
  `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RouteCast demo" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Boucle Houilles – Vallée de Chevreuse</name></metadata>
  <trk>
    <name>Boucle Houilles – Vallée de Chevreuse</name>
    <type>cycling</type>
    <trkseg>
${body}
    </trkseg>
  </trk>
</gpx>
`,
);
console.log('demo points', pts.length, 'km', (d / 1000).toFixed(1));

// Icônes PNG (dégradé + trace stylisée), encodeur PNG minimal
function png(size) {
  const crcT = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size,
        o = y * (size * 4 + 1) + 1 + x * 4;
      let r = 11,
        g = 16,
        b = 32;
      const curve = 0.62 - 0.18 * Math.sin(u * Math.PI * 2.2);
      const dist = Math.abs(v - curve);
      if (dist < 0.045 && u > 0.14 && u < 0.88) {
        const t = u;
        r = 56 + (99 - 56) * t;
        g = 189 + (102 - 189) * t;
        b = 248 + (241 - 248) * t;
      }
      const dx = u - 0.62,
        dy = v - (0.62 - 0.18 * Math.sin(0.62 * Math.PI * 2.2));
      if (dx * dx + dy * dy < 0.006) {
        r = 251;
        g = 191;
        b = 36;
      }
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
writeFileSync('public/icon-192.png', png(192));
writeFileSync('public/icon-512.png', png(512));
writeFileSync('public/apple-touch-icon.png', png(180));
