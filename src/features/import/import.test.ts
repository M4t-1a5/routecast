/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { FitBaseType, FitEncoder } from 'fit-file-parser';
import { beforeAll, describe, expect, it } from 'vitest';
import { ImportError, detectFormat, fitDataToTrack, parseFit, parseGpx, parseTrackFile } from './index';

const root = resolve(__dirname, '../../..');
const fixture = (name: string) => readFileSync(resolve(root, 'tests/fixtures', name), 'utf8');

beforeAll(() => {
  // Vitest tourne en environnement node : DOMParser fourni par xmldom.
  if (typeof globalThis.DOMParser === 'undefined') {
    (globalThis as unknown as { DOMParser: unknown }).DOMParser = XmlDomParser;
  }
});

const gpx = (body: string) =>
  `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`;

describe('parseGpx', () => {
  it('concatène plusieurs trk/trkseg dans l’ordre, temps et altitudes nulles', () => {
    const t = parseGpx(fixture('multi-segment.gpx'), 'x.gpx');
    expect(t.name).toBe('Sortie test');
    expect(t.source).toBe('gpx');
    expect(t.sport).toBe('running');
    expect(t.points.map((p) => p.lat)).toEqual([48.85, 48.851, 48.851, 48.852, 48.853, 48.854]);
    expect(t.points[3].ele).toBeNull();
    expect(t.points[0].time).toBe(Date.parse('2026-05-10T07:00:00Z'));
    expect(t.hasTime).toBe(true);
  });

  it('utilise <rte> si aucune trace, nom du rte', () => {
    const t = parseGpx(fixture('route-only.gpx'), 'plan.gpx');
    expect(t.points).toHaveLength(3);
    expect(t.name).toBe('Itinéraire planifié');
    expect(t.points.every((p) => p.ele === null && p.time === null)).toBe(true);
    expect(t.hasTime).toBe(false);
    expect(t.sport).toBeNull();
  });

  it('nom de fichier sans extension par défaut ; type cycling', () => {
    const t = parseGpx(
      gpx(
        '<trk><type>cycling</type><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1.001" lon="1"/></trkseg></trk>',
      ),
      'dossier/Ma sortie.GPX',
    );
    expect(t.name).toBe('Ma sortie');
    expect(t.sport).toBe('cycling');
  });

  it('gère les préfixes de namespace', () => {
    const xml = `<?xml version="1.0"?><g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:trk><g:trkseg>
      <g:trkpt lat="1" lon="1"><g:ele>10</g:ele></g:trkpt><g:trkpt lat="1.001" lon="1"><g:ele>12</g:ele></g:trkpt>
      </g:trkseg></g:trk></g:gpx>`;
    const t = parseGpx(xml, 'a.gpx');
    expect(t.points.map((p) => p.ele)).toEqual([10, 12]);
  });

  it('ignore les points aux coordonnées invalides', () => {
    const t = parseGpx(
      gpx(
        '<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="abc" lon="1"/><trkpt lat="0" lon="0"/><trkpt lat="1.001" lon="1"/></trkseg></trk>',
      ),
    );
    expect(t.points).toHaveLength(2);
  });

  it('lève ImportError si aucune trace exploitable', () => {
    expect(() => parseGpx(gpx('<wpt lat="1" lon="1"/>'))).toThrow(ImportError);
    expect(() => parseGpx(gpx('<wpt lat="1" lon="1"/>'))).toThrow(/aucune trace exploitable/);
    expect(() => parseGpx(gpx('<trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk>'))).toThrow(ImportError);
  });

  it('lève ImportError pour un XML invalide ou un autre format', () => {
    expect(() => parseGpx('ceci n’est pas du xml <<<')).toThrow(ImportError);
    expect(() => parseGpx('<?xml version="1.0"?><kml><Document/></kml>')).toThrow(ImportError);
    expect(() => parseGpx('')).toThrow(ImportError);
  });
});

/* ------------------------------ FIT ------------------------------ */

const SEMI = 2 ** 31 / 180;

/** Construit un FIT minimal (file_id + records + session/course) avec l'encodeur de fit-file-parser. */
function makeFit(
  opts: { course?: boolean; sport?: number; n?: number; withAlt?: boolean } = {},
): ArrayBuffer {
  const enc = new FitEncoder();
  const n = opts.n ?? 20;
  const t0 = FitEncoder.toFitTimestamp(new Date('2026-05-10T07:00:00Z'));
  enc.writeMessage(0, [{ number: 0, size: 1, baseType: FitBaseType.Enum, value: opts.course ? 6 : 4 }]);
  if (opts.course) {
    const name = FitEncoder.string('Parcours FIT');
    enc.writeMessage(
      31,
      [
        { number: 5, size: name.byteLength, baseType: FitBaseType.String, value: name },
        { number: 4, size: 1, baseType: FitBaseType.Enum, value: opts.sport ?? 2 },
      ],
      1,
    );
  }
  for (let i = 0; i < n; i++) {
    const lat = 48.8 + i * 0.001;
    const fields = [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: t0 + i * 10 },
      { number: 0, size: 4, baseType: FitBaseType.Sint32, value: Math.round(lat * SEMI) },
      { number: 1, size: 4, baseType: FitBaseType.Sint32, value: Math.round(2.3 * SEMI) },
    ];
    if (opts.withAlt !== false) {
      fields.push({
        number: 78,
        size: 4,
        baseType: FitBaseType.Uint32,
        value: Math.round((100 + i + 500) * 5),
      });
    }
    enc.writeMessage(20, fields, 2);
  }
  if (!opts.course) {
    enc.writeMessage(18, [{ number: 5, size: 1, baseType: FitBaseType.Enum, value: opts.sport ?? 2 }], 3);
  }
  const bytes = enc.close();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('parseFit', () => {
  it('lit une activité : positions, altitude, temps, sport', async () => {
    const t = await parseFit(makeFit({ sport: 1 }), 'activite.fit');
    expect(t.source).toBe('fit');
    expect(t.points).toHaveLength(20);
    expect(t.points[0].lat).toBeCloseTo(48.8, 5);
    expect(t.points[0].lon).toBeCloseTo(2.3, 5);
    expect(t.points[5].ele).toBeCloseTo(105, 1);
    expect(t.points[1].time! - t.points[0].time!).toBe(10_000);
    expect(t.points[0].time).toBe(Date.parse('2026-05-10T07:00:00Z'));
    expect(t.hasTime).toBe(true);
    expect(t.sport).toBe('running');
    expect(t.name).toBe('activite');
  });

  it('lit un fichier course : nom, sport, temps ignorés', async () => {
    const t = await parseFit(makeFit({ course: true, sport: 2 }), 'c.fit');
    expect(t.name).toBe('Parcours FIT');
    expect(t.sport).toBe('cycling');
    expect(t.hasTime).toBe(false);
    expect(t.points.every((p) => p.time === null)).toBe(true);
  });

  it('altitude absente → ele null', async () => {
    const t = await parseFit(makeFit({ withAlt: false }), 'a.fit');
    expect(t.points.every((p) => p.ele === null)).toBe(true);
  });

  it('lève ImportError sur un fichier corrompu ou sans GPS', async () => {
    await expect(parseFit(new Uint8Array([1, 2, 3]).buffer)).rejects.toBeInstanceOf(ImportError);
    const junk = new Uint8Array(64).fill(7);
    await expect(parseFit(junk.buffer)).rejects.toBeInstanceOf(ImportError);
    expect(() => fitDataToTrack({ records: [{ timestamp: new Date() }] })).toThrow(ImportError);
  });

  it('fitDataToTrack : repli sur course_points, enhanced_altitude prioritaire', () => {
    const t = fitDataToTrack(
      {
        records: [],
        course_points: [
          { position_lat: 45, position_long: 6, altitude: 1000 },
          { position_lat: 45.01, position_long: 6, enhanced_altitude: 1100, altitude: 1 },
        ],
        sports: [{ sport: 'cycling' }],
      },
      'x.fit',
    );
    expect(t.points.map((p) => p.ele)).toEqual([1000, 1100]);
    expect(t.sport).toBe('cycling');
  });
});

describe('parseTrackFile / detectFormat', () => {
  it('choisit selon l’extension, insensible à la casse', async () => {
    const f = new File([fixture('multi-segment.gpx')], 'Sortie.GPX');
    expect((await parseTrackFile(f)).source).toBe('gpx');
    const fit = new File([makeFit()], 'RIDE.FIT');
    expect((await parseTrackFile(fit)).source).toBe('fit');
  });

  it('détecte via le contenu sans extension', async () => {
    expect(detectFormat('fichier', new Uint8Array(makeFit()))).toBe('fit');
    expect(detectFormat('fichier', new TextEncoder().encode('<?xml version="1.0"?><gpx>'))).toBe('gpx');
    const f = new File([makeFit()], 'sans-extension');
    expect((await parseTrackFile(f)).source).toBe('fit');
  });

  it('format non supporté → ImportError', async () => {
    const f = new File(['bonjour'], 'notes.txt');
    await expect(parseTrackFile(f)).rejects.toThrow(/Format non supporté/);
    await expect(parseTrackFile(new File([], 'vide.gpx'))).rejects.toBeInstanceOf(ImportError);
  });
});
