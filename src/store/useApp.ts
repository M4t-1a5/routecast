/**
 * Store global (Zustand). OWNER : intégration (orchestrateur).
 * Les composants lisent l'état via des sélecteurs : useApp((s) => s.route).
 */
import { create } from 'zustand';
import type {
  AppError,
  BaseMap,
  ConfidenceSummary,
  DepartureOption,
  ForecastHorizon,
  LoadStatus,
  MapLayer,
  PointWeather,
  ProfileOverlay,
  RideSettings,
  RideStats,
  RideSummary,
  Route,
  SpeedModel,
  StoredRoute,
  ThemeMode,
  Timing,
  WeatherGrid,
  WeatherSample,
} from '../types';
import { defaultStartTime } from '../features/route';

export interface AppState {
  /* Données */
  history: StoredRoute[];
  /** Trace telle qu'importée (sens original). */
  baseRoute: Route | null;
  /** Trace active (= baseRoute ou inversée selon settings.reversed). */
  route: Route | null;
  settings: RideSettings;
  timing: Timing | null;
  samples: WeatherSample[];
  weather: PointWeather[];
  confidence: ConfidenceSummary | null;
  stats: RideStats | null;
  summary: RideSummary | null;
  departures: DepartureOption[];
  grid: WeatherGrid | null;
  horizon: ForecastHorizon | null;

  /* Statuts */
  importStatus: LoadStatus;
  weatherStatus: LoadStatus;
  confidenceStatus: LoadStatus;
  gridStatus: LoadStatus;
  departuresStatus: LoadStatus;
  error: AppError | null;

  /* UI */
  layer: MapLayer;
  baseMap: BaseMap;
  theme: ThemeMode;
  profileOverlay: ProfileOverlay;
  /** Index du RoutePoint survolé (profil ↔ carte), null sinon. */
  hoverIndex: number | null;
  /** Instant affiché par la timeline (epoch ms), null = suivre l'ETA (affichage "à l'heure de passage"). */
  timelineTime: number | null;
  playing: boolean;
  /** Demande de recentrage carte (compteur incrémenté). */
  recenterTick: number;
  sheetOpen: boolean;

  /* Setters simples (les actions asynchrones sont dans store/actions.ts) */
  set: (patch: Partial<AppState>) => void;
  setLayer: (l: MapLayer) => void;
  setBaseMap: (b: BaseMap) => void;
  setTheme: (t: ThemeMode) => void;
  setProfileOverlay: (o: ProfileOverlay) => void;
  setHoverIndex: (i: number | null) => void;
  setTimelineTime: (t: number | null) => void;
  setPlaying: (p: boolean) => void;
  recenter: () => void;
  clearError: () => void;
}

export const DEFAULT_SPEED_MODEL: SpeedModel = { kind: 'fixed', speedKmh: 25 };

export const defaultSettings = (): RideSettings => ({
  startTime: defaultStartTime(new Date(), 'Europe/Paris'),
  speedModel: DEFAULT_SPEED_MODEL,
  reversed: false,
  timezone: 'Europe/Paris',
});

export const useApp = create<AppState>((set) => ({
  history: [],
  baseRoute: null,
  route: null,
  settings: defaultSettings(),
  timing: null,
  samples: [],
  weather: [],
  confidence: null,
  stats: null,
  summary: null,
  departures: [],
  grid: null,
  horizon: null,

  importStatus: 'idle',
  weatherStatus: 'idle',
  confidenceStatus: 'idle',
  gridStatus: 'idle',
  departuresStatus: 'idle',
  error: null,

  layer: 'wind',
  baseMap: 'vector',
  theme: 'dark',
  profileOverlay: 'none',
  hoverIndex: null,
  timelineTime: null,
  playing: false,
  recenterTick: 0,
  sheetOpen: false,

  set: (patch) => set(patch),
  setLayer: (layer) => set({ layer }),
  setBaseMap: (baseMap) => set({ baseMap }),
  setTheme: (theme) => set({ theme }),
  setProfileOverlay: (profileOverlay) => set({ profileOverlay }),
  setHoverIndex: (hoverIndex) => set({ hoverIndex }),
  setTimelineTime: (timelineTime) => set({ timelineTime }),
  setPlaying: (playing) => set({ playing }),
  recenter: () => set((s) => ({ recenterTick: s.recenterTick + 1 })),
  clearError: () => set({ error: null }),
}));
