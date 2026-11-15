/**
 * RouteCast — types partagés.
 * CONTRAT entre les modules : ne pas modifier sans mettre à jour tous les consommateurs.
 *
 * Conventions d'unités (partout dans l'app) :
 *  - distances en mètres (m), altitudes en m
 *  - vitesses du vent en km/h, vitesses de déplacement en km/h
 *  - temps : timestamps epoch en millisecondes (number), durées en secondes
 *  - angles en degrés, 0 = Nord, sens horaire. `windDirection` = direction D'OÙ vient le vent (convention météo)
 *  - pente en % (positive = montée)
 *  - températures en °C, précipitations en mm/h, probabilités et couverture en %
 */

/* ------------------------------------------------------------------ */
/* Import / parsing                                                     */
/* ------------------------------------------------------------------ */

export type Sport = 'cycling' | 'running';
export type TrackSource = 'gpx' | 'fit' | 'demo';

/** Point brut issu d'un fichier (avant nettoyage). */
export interface RawPoint {
  lat: number;
  lon: number;
  /** Altitude, null si absente du fichier. */
  ele: number | null;
  /** Horodatage epoch ms si présent (activité enregistrée), sinon null. */
  time: number | null;
}

/** Résultat brut d'un parsing de fichier, segments déjà concaténés dans l'ordre. */
export interface ParsedTrack {
  name: string;
  source: TrackSource;
  sport: Sport | null;
  /** Tous les segments concaténés (au moins 2 points). */
  points: RawPoint[];
  /** true si la majorité des points ont un horodatage exploitable. */
  hasTime: boolean;
}

/* ------------------------------------------------------------------ */
/* Route (trace nettoyée et rééchantillonnée)                          */
/* ------------------------------------------------------------------ */

/** Point de la trace rééchantillonnée (~100 m). */
export interface RoutePoint {
  lat: number;
  lon: number;
  /** Altitude lissée (m). */
  ele: number;
  /** Distance cumulée depuis le départ (m). */
  dist: number;
  /** Pente (%) du segment [i, i+1]. Le dernier point reprend la pente du précédent. */
  grade: number;
  /** Cap (°) du segment [i, i+1]. Le dernier point reprend le cap du précédent. */
  bearing: number;
  /** Temps écoulé depuis le départ (s) dans l'enregistrement original, si dispo (rejouer ma vitesse). */
  elapsed: number | null;
}

export interface RouteStats {
  distance: number; // m
  ascent: number; // m (D+)
  descent: number; // m (D-)
  minEle: number;
  maxEle: number;
}

export type ClimbCategory = 'HC' | '1' | '2' | '3' | '4';

export interface Climb {
  startIdx: number;
  /** Index du sommet (= fin de la montée). */
  endIdx: number;
  startDist: number; // m
  endDist: number; // m
  length: number; // m
  gain: number; // m
  avgGrade: number; // %
  maxGrade: number; // %
  category: ClimbCategory;
  summitEle: number;
}

export interface Route {
  id: string;
  name: string;
  source: TrackSource;
  sport: Sport;
  createdAt: number;
  points: RoutePoint[];
  stats: RouteStats;
  climbs: Climb[];
  /** true si `elapsed` est renseigné (FIT/GPX d'activité). */
  hasRecordedTime: boolean;
}

/** Ce qui est stocké dans l'historique IndexedDB. */
export interface StoredRoute {
  route: Route;
  lastOpenedAt: number;
  /** Derniers réglages utilisés pour cette trace (facultatif). */
  settings?: RideSettings;
}

/* ------------------------------------------------------------------ */
/* Allure / modèle de vitesse                                           */
/* ------------------------------------------------------------------ */

export type SpeedModel =
  | { kind: 'fixed'; speedKmh: number }
  | {
      kind: 'power';
      powerW: number;
      /** Masse totale cycliste + vélo (kg). */
      massKg: number;
      cda: number; // m²
      crr: number;
    }
  | { kind: 'replay' }
  | { kind: 'run'; paceSecPerKm: number };

export interface RideSettings {
  /** Départ, epoch ms. */
  startTime: number;
  speedModel: SpeedModel;
  /** Parcours dans le sens inverse. */
  reversed: boolean;
  /** Fuseau d'affichage, par défaut 'Europe/Paris'. */
  timezone: string;
}

/** Vent au point i et à l'instant t, utilisé par le modèle de puissance (itération vent ↔ heure). */
export type WindProvider = (
  pointIndex: number,
  timeMs: number,
) => { speedKmh: number; directionDeg: number } | null;

/** Résultat du calcul de passage. */
export interface Timing {
  /** ETA epoch ms pour chaque RoutePoint (même longueur que route.points). */
  etas: number[];
  /** Vitesse (km/h) sur le segment [i, i+1]. */
  speeds: number[];
  durationSec: number;
  avgSpeedKmh: number;
  arrival: number; // epoch ms
}

/* ------------------------------------------------------------------ */
/* Météo                                                                */
/* ------------------------------------------------------------------ */

/** Valeurs météo horaires (ou interpolées) en un lieu. */
export interface WeatherValues {
  temperature: number; // °C
  apparentTemperature: number; // °C
  precipitation: number; // mm/h
  precipitationProbability: number; // %
  windSpeed: number; // km/h
  windDirection: number; // ° (d'où il vient)
  windGusts: number; // km/h
  cloudCover: number; // %
  weatherCode: number; // WMO
  isDay: boolean;
}

export interface WeatherHour extends WeatherValues {
  time: number; // epoch ms (heure pleine UTC)
}

/** Série horaire de prévision en un point d'échantillonnage de la trace. */
export interface WeatherSample {
  lat: number;
  lon: number;
  /** Index du RoutePoint le plus proche. */
  routeIndex: number;
  dist: number; // m
  hours: WeatherHour[];
}

export type WindRelation = 'head' | 'tail' | 'cross';

/** Météo interpolée en un RoutePoint, à l'heure de passage. */
export interface PointWeather extends WeatherValues {
  routeIndex: number;
  time: number; // ETA epoch ms
  /** Composante longitudinale : >0 = vent de face, <0 = vent de dos (km/h). */
  headwind: number;
  /** Composante latérale (valeur absolue, km/h). */
  crosswind: number;
  windRelation: WindRelation;
}

/** Plage P10–P90 (ou min–max des modèles). */
export interface Range {
  low: number;
  mid: number;
  high: number;
}

export interface PointConfidence {
  routeIndex: number;
  /** 0–100. */
  score: number;
  /** Sous-scores 0–100. */
  spreadScore: number;
  agreementScore: number;
  leadTimeScore: number;
  temperature: Range;
  windSpeed: Range;
  precipitation: Range;
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ConfidenceSummary {
  score: number; // 0–100
  level: ConfidenceLevel;
  /** Explications lisibles (FR) pour l'infobulle. */
  reasons: string[];
  points: PointConfidence[];
}

/** Grille météo régulière autour de la trace (champ de particules, heatmap pluie, champ de température). */
export interface WeatherGrid {
  bbox: [west: number, south: number, east: number, north: number];
  nx: number; // colonnes (lon)
  ny: number; // lignes (lat)
  /** Heures disponibles (epoch ms), communes à toutes les cellules. */
  times: number[];
  /**
   * cells[j * nx + i] = série horaire pour la cellule (lon_i, lat_j), j=0 au SUD.
   * cells[k].hours[t] aligné sur `times[t]`.
   */
  cells: { lat: number; lon: number; hours: WeatherHour[] }[];
}

/** Horizon de prévision vis-à-vis de la date de départ. */
export type ForecastHorizon =
  | { kind: 'ok'; daysAhead: number }
  | { kind: 'low-reliability'; daysAhead: number } // > ~7 jours
  | { kind: 'too-far'; daysAhead: number } // > 16 jours
  | { kind: 'past'; daysAhead: number };

/* ------------------------------------------------------------------ */
/* Synthèse / comparaison                                               */
/* ------------------------------------------------------------------ */

export interface RideStats {
  distance: number;
  ascent: number;
  descent: number;
  durationSec: number;
  arrival: number;
  avgSpeedKmh: number;
  headwindShare: number; // 0–1 (part de distance avec vent de face)
  tailwindShare: number; // 0–1
  minTemp: number;
  maxTemp: number;
  maxPrecipProbability: number; // %
  totalPrecipitation: number; // mm estimés sur la sortie
  confidence: number | null; // 0–100
}

export type GearAdvice =
  | 'windbreaker'
  | 'rain-jacket'
  | 'arm-warmers'
  | 'leg-warmers'
  | 'gloves'
  | 'winter-layers'
  | 'lights'
  | 'sunscreen'
  | 'extra-water';

export interface RideSummary {
  /** Phrases en français, générées par règles. */
  sentences: string[];
  gear: { id: GearAdvice; label: string }[];
  /** Score de « confort » 0–100 (utilisé pour comparer départs / sens). */
  comfortScore: number;
}

export interface DepartureOption {
  startTime: number;
  reversed: boolean;
  comfortScore: number;
  durationSec: number;
  headwindShare: number;
  maxPrecipProbability: number;
  minTemp: number;
  isBest: boolean;
}

/* ------------------------------------------------------------------ */
/* UI / carte                                                           */
/* ------------------------------------------------------------------ */

export type MapLayer = 'wind' | 'rain' | 'temperature';
export type BaseMap = 'vector' | 'topo';
export type ThemeMode = 'dark' | 'light';
export type ProfileOverlay = 'none' | 'wind' | 'temperature' | 'rain';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AppError {
  kind: 'invalid-file' | 'api' | 'too-far' | 'past' | 'storage' | 'unknown';
  message: string;
}
