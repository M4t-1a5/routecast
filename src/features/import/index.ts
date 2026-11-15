// OWNER: agent Parsing. Signatures = contrat, ne pas changer.
export { ImportError } from './errors';
export { parseGpx } from './gpx';
export { parseFit, fitDataToTrack } from './fit';
export { parseTrackFile, detectFormat } from './detect';
export {
  listStoredRoutes,
  saveStoredRoute,
  deleteStoredRoute,
  renameStoredRoute,
  getStoredRoute,
  loadPrefs,
  savePrefs,
} from './storage';
