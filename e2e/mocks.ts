import type { Page, Route } from '@playwright/test';

/** Réponses Open-Meteo synthétiques et déterministes (forecast, multi-modèles, ensemble) + RainViewer. */
function hourlyFor(url: URL) {
  const lats = (url.searchParams.get('latitude') ?? '48.9').split(',').map(Number);
  const lons = (url.searchParams.get('longitude') ?? '2.2').split(',').map(Number);
  const vars = (url.searchParams.get('hourly') ?? 'temperature_2m').split(',');
  const models = url.searchParams.get('models')?.split(',') ?? [];
  const isEnsemble = url.hostname.startsWith('ensemble');
  const from = Date.parse(
    `${url.searchParams.get('start_date') ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`,
  );
  const to = Date.parse(
    `${url.searchParams.get('end_date') ?? new Date(from + 2 * 86400000).toISOString().slice(0, 10)}T23:00:00Z`,
  );
  const times: number[] = [];
  for (let t = from; t <= to; t += 3600_000) times.push(t / 1000);

  const value = (v: string, t: number, lat: number, lon: number, jitter: number) => {
    const h = new Date(t * 1000).getUTCHours();
    switch (v) {
      case 'temperature_2m':
        return 8 + 6 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + (lat - 48.8) * 10 + jitter;
      case 'apparent_temperature':
        return 6 + 6 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + jitter;
      case 'precipitation':
        return h >= 13 && h <= 15 && lon < 2.05 ? 1.2 + jitter / 4 : 0;
      case 'precipitation_probability':
        return h >= 12 && h <= 16 ? 60 : 10;
      case 'wind_speed_10m':
        return Math.max(0, 18 + (lon - 2) * 20 + jitter);
      case 'wind_direction_10m':
        return 250;
      case 'wind_gusts_10m':
        return 35 + jitter;
      case 'cloud_cover':
        return 60;
      case 'weather_code':
        return h >= 13 && h <= 15 ? 61 : 2;
      case 'is_day':
        return h >= 7 && h < 17 ? 1 : 0;
      default:
        return 0;
    }
  };

  const locs = lats.map((lat, k) => {
    const lon = lons[k] ?? lons[0];
    const hourly: Record<string, number[]> = { time: times };
    for (const v of vars) {
      if (isEnsemble) {
        const suffixes = ['icon_seamless_eps', 'ncep_gefs_seamless', 'ecmwf_ifs025_ensemble'];
        for (const s of suffixes) {
          hourly[`${v}_${s}`] = times.map((t) => value(v, t, lat, lon, 0));
          for (let m = 1; m <= 10; m++)
            hourly[`${v}_member${String(m).padStart(2, '0')}_${s}`] = times.map((t) =>
              value(v, t, lat, lon, ((m % 5) - 2) * 0.6),
            );
        }
      } else if (models.length > 1) {
        models.forEach(
          (mod, i) => (hourly[`${v}_${mod}`] = times.map((t) => value(v, t, lat, lon, (i - 1.5) * 0.5))),
        );
      } else {
        hourly[v] = times.map((t) => value(v, t, lat, lon, 0));
      }
    }
    return { latitude: lat, longitude: lon, ...(k > 0 ? { location_id: k } : {}), hourly };
  });
  return locs.length === 1 ? locs[0] : locs;
}

export async function mockApis(page: Page) {
  const fulfillJson = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(/open-meteo\.com\//, (route) =>
    fulfillJson(route, hourlyFor(new URL(route.request().url()))),
  );
  await page.route(/api\.rainviewer\.com\//, (route) =>
    fulfillJson(route, { host: 'https://tilecache.rainviewer.com', radar: { past: [], nowcast: [] } }),
  );
  // Tuiles externes : coupées pour un test hors-ligne et déterministe (la carte bascule sur son fond de secours).
  await page.route(/(openfreemap\.org|opentopomap\.org|tilecache\.rainviewer\.com)/, (route) =>
    route.abort(),
  );
}
