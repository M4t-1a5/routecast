import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import { OFM_ATTRIBUTION, fallbackStyle, frenchLabels, topoStyle } from './style';

describe('styles', () => {
  it('libellés FR sur les couches de noms, pas sur les cartouches de routes', () => {
    const s: StyleSpecification = {
      version: 8,
      sources: { openmaptiles: { type: 'vector', url: 'x' } },
      layers: [
        {
          id: 'city',
          type: 'symbol',
          source: 'openmaptiles',
          layout: { 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']] },
        },
        {
          id: 'shield',
          type: 'symbol',
          source: 'openmaptiles',
          layout: { 'text-field': ['to-string', ['get', 'ref']] },
        },
      ],
    };
    const out = frenchLabels(s);
    expect(JSON.stringify(out.layers[0])).toContain('name:fr');
    expect(out.layers[1]).toEqual(s.layers[1]);
    expect((out.sources.openmaptiles as { attribution?: string }).attribution).toBe(OFM_ATTRIBUTION);
  });
  it('fond topo OpenTopoMap (maxzoom 17) et repli uni', () => {
    const t = topoStyle('light');
    const src = t.sources.otm as { tiles: string[]; maxzoom: number; attribution: string };
    expect(src.tiles).toHaveLength(3);
    expect(src.maxzoom).toBe(17);
    expect(src.attribution).toContain('OpenTopoMap');
    expect(fallbackStyle('dark').layers[0]).toMatchObject({
      id: 'bg',
      type: 'background',
      paint: { 'background-color': '#0b1020' },
    });
  });
});
