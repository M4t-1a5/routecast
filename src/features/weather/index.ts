// OWNER: agent Météo. Signatures = contrat, ne pas changer.
export { WeatherApiError } from './errors';
export { relativeWind } from './wind';
export { forecastHorizon, pickSampleIndices } from './sampling';
export { fetchForecast, loadRouteWeather } from './api';
export { weatherAt, interpolateAlongRoute, makeWindProvider } from './interpolate';
export { fetchWeatherGrid, sampleGrid } from './grid';
export { fetchRainViewerFrames, type RainViewerFrames } from './rainviewer';
