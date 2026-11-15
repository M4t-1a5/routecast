# RouteCast — la météo sur votre trace

RouteCast affiche la **météo prévue le long d'une trace GPX ou FIT** (vélo ou course à pied), **à l'heure où vous passerez** à chaque point du parcours : vent de face ou de dos, pluie, température, rafales, indice de confiance, et un résumé clair avec des conseils d'équipement.

100 % gratuit et open source, **sans clé d'API**.

**En ligne : https://m4t-1a5.github.io/routecast/**

## Démarrer

```bash
npm install
npm run dev        # http://localhost:5173
```

Sur l'écran d'accueil, cliquez sur **« Essayer avec la démo »** (boucle Houilles – vallée de Chevreuse, ~96 km) ou déposez un fichier `.gpx` / `.fit`.

## Scripts

| Commande            | Rôle                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `npm run dev`       | Serveur de développement Vite                                                            |
| `npm run build`     | Vérification des types (`tsc -b`) + build de production dans `dist/` (PWA incluse)       |
| `npm run preview`   | Sert le build de production                                                              |
| `npm test`          | Tests unitaires (Vitest)                                                                 |
| `npm run test:e2e`  | Test de bout en bout (Playwright ; la première fois : `npx playwright install chromium`) |
| `npm run lint`      | ESLint                                                                                   |
| `npm run typecheck` | `tsc --noEmit`                                                                           |
| `npm run format`    | Prettier                                                                                 |

## Fonctionnalités

- **Import** GPX (multi-segments, `rte`, points sans altitude, doublons) et FIT (activité ou parcours), par glisser-déposer ou bouton.
- **Nettoyage** : rééchantillonnage tous les ~100 m, lissage de l'altitude (D+ non gonflé), D+/D-, pente et cap par segment, **détection et catégorisation des montées**.
- **Heure de passage** à chaque point selon la date et l'heure de départ (par défaut : dimanche prochain à 9 h, Europe/Paris) et un modèle de vitesse :
  - vitesse moyenne fixe ;
  - **puissance** (W, masse, CdA, Crr) avec un modèle physique tenant compte de la pente **et du vent prévu** ;
  - **rejouer la vitesse réelle** d'une activité enregistrée ;
  - **course à pied** (allure ajustée selon la pente).
- **Météo le long de la trace** (Open-Meteo, requêtes groupées + cache IndexedDB), interpolée dans le temps et le long du parcours ; **vent relatif** (face / dos / travers).
- **Carte** MapLibre (OpenFreeMap clair/sombre, OpenTopoMap en option) avec trois couches : **vent** (flèches + particules animées), **pluie** (radar RainViewer animé pour les 2 prochaines heures, sinon champ de précipitations prévues), **température** (champ interpolé).
- **Profil d'altitude** interactif coloré par pente, synchronisé avec la carte, superpositions vent / température / pluie.
- **Timeline** avec lecture animée du cycliste et de la météo.
- **Indice de confiance** (0–100) : dispersion de l'ensemble, accord entre modèles (ECMWF, ICON, GFS, Météo-France), échéance. Voir [docs/confidence.md](docs/confidence.md).
- **Résumé de la sortie** en langage clair, conseils d'équipement, **comparaison d'heures de départ** et du **sens inverse**.
- **Export PNG**, **lien partageable** (état dans l'URL, trace incluse si elle est légère), **historique** local, **PWA** installable et consultable hors-ligne.

## Architecture

```
src/
  types.ts              Types partagés (contrat entre modules)
  store/                État Zustand + orchestration du pipeline (actions.ts)
  features/
    import/             Parsing GPX/FIT, historique IndexedDB
    route/              Rééchantillonnage, D+, pente, cap, montées, modèle de vitesse (ETA)
    weather/            Open-Meteo, cache, interpolation, vent relatif, grille, RainViewer
    confidence/         Indice de confiance
    summary/            Statistiques, résumé par règles, comparaison des départs
    map/                Carte MapLibre et couches météo
    profile/            Profil d'altitude (uPlot)
  components/           Interface (panneaux, timeline, bottom sheet…)
  lib/                  Couleurs, formatage, fuseau, partage, export
```

La logique métier est faite de fonctions pures, séparées de l'interface et testées avec Vitest.

## Déploiement gratuit

Le build est statique (`dist/`).

- **Vercel** : importez le dépôt, preset « Vite », commande `npm run build`, dossier `dist`.
- **Netlify** : commande `npm run build`, dossier de publication `dist`.
- **GitHub Pages** (utilisé pour la version en ligne) : après une modification, lancez
  ```bash
  npm run deploy
  ```
  Le script construit l'app avec le bon sous-dossier (`/<nom-du-dépôt>/`) et publie `dist/` sur la branche `gh-pages`. La mise en ligne prend environ une minute.

## Intégrer RouteCast dans une autre application

**Le plus simple : une iframe** vers la version en ligne. Elle fonctionne dans n'importe quel framework (React, Vue, HTML…) :

```html
<iframe
  src="https://m4t-1a5.github.io/routecast/"
  title="RouteCast"
  allow="clipboard-write; fullscreen"
  style="width: 100%; height: 100%; min-height: 600px; border: 0"
></iframe>
```

Pour ouvrir directement une trace avec des réglages, utilisez un lien de partage (bouton « Partager » dans l'app) comme `src` de l'iframe.

**Intégration dans le code** : la logique métier est faite de fonctions pures, sans dépendance à l'interface. Vous pouvez copier ou importer depuis ce dépôt :

- `src/features/import` : `parseGpx`, `parseFit`, `parseTrackFile` ;
- `src/features/route` : `buildRoute`, `computeTiming`, `reverseRoute` ;
- `src/features/weather` : `loadRouteWeather`, `interpolateAlongRoute`, `relativeWind` ;
- `src/features/confidence` et `src/features/summary` : indice de confiance, résumé, comparaison des départs.

Les types partagés sont dans `src/types.ts`. L'enchaînement complet est dans `src/store/actions.ts` (fonction `recompute`).

## Données et crédits

- Fonds de carte : © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, [OpenFreeMap](https://openfreemap.org), © OpenMapTiles ; relief : [OpenTopoMap](https://opentopomap.org) (CC-BY-SA).
- Prévisions : [Open-Meteo](https://open-meteo.com) (CC BY 4.0) : API forecast, API ensemble et multi-modèles (ECMWF, DWD ICON, NOAA GFS, Météo-France).
- Radar de pluie : [RainViewer](https://www.rainviewer.com).
- Bibliothèques : MapLibre GL JS, React, Zustand, uPlot, @tmcw/togeojson, fit-file-parser, idb-keyval, Framer Motion, Tailwind CSS.

Les API gratuites ont des limites d'usage : RouteCast groupe les requêtes (plusieurs points par appel), met en cache les réponses et ne fait jamais un appel par point brut.
