# Indice de confiance RouteCast

L'indice (0–100) dit à quel point on peut se fier à la prévision affichée **à l'heure où vous passerez** à chaque point de la trace. Il ne dit pas si la météo est bonne ou mauvaise : un orage certain donne une confiance élevée.

Code : `src/features/confidence/` (`fetch.ts` pour les données, `score.ts` pour la formule, testée dans `confidence.test.ts`).

## Sources

| Source        | Endpoint                                                                                                | Contenu                                                           | Points interrogés                                                                                                | Cache |
| ------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----- |
| Ensemble      | `ensemble-api.open-meteo.com/v1/ensemble`, `models=icon_seamless,gfs_seamless,ecmwf_ifs025`             | ~120 membres : ICON-EPS (40), GEFS (31), ECMWF IFS 0,25° ENS (51) | ≤ 6 échantillons répartis sur la trace, étendus aux autres par plus proche voisin (distance le long de la trace) | 3 h   |
| Multi-modèles | `api.open-meteo.com/v1/forecast`, `models=ecmwf_ifs025,icon_seamless,gfs_seamless,meteofrance_seamless` | 4 prévisions déterministes                                        | ≤ 12 échantillons, même extension                                                                                | 1 h   |

Variables : `temperature_2m`, `wind_speed_10m`, `precipitation`.

### Format des réponses (constaté le 14/11/2026)

- Plusieurs lieux → **tableau** d'objets, `location_id` présent à partir du 2ᵉ lieu.
- Ensemble : une clé par membre **et** par modèle, le contrôle n'a pas de `memberNN` :
  `temperature_2m_icon_seamless_eps`, `temperature_2m_member01_icon_seamless_eps`, …,
  `temperature_2m_ncep_gefs_seamless`, `…_member30_ncep_gefs_seamless`,
  `temperature_2m_ecmwf_ifs025_ensemble`, `…_member50_ecmwf_ifs025_ensemble`.
  Les suffixes ne sont **pas** ceux passés dans `models` (`_eps`, `ncep_gefs`, `_ensemble`).
- Multi-modèles : `temperature_2m_ecmwf_ifs025`, `temperature_2m_icon_seamless`, `temperature_2m_gfs_seamless`, `temperature_2m_meteofrance_seamless`.
- Les valeurs peuvent être `null` au-delà de l'horizon d'un modèle (ICON-EPS ≈ 7 j, ECMWF ENS ≈ 15 j).

Le parseur prend toutes les clés `variable` ou `variable_*` (sauf `*_probability`) et ignore les `null` : il est robuste aux changements de suffixes.

Les appels ne lèvent jamais d'exception : en cas d'échec, `ensemble`/`models` sont des tableaux vides et l'indice se rabat sur les autres composantes.

## Formule par point

Pour chaque échantillon de la trace, à l'heure de passage (ETA) — l'heure de prévision la plus proche, à ±1,5 h près :

### 1. Dispersion de l'ensemble — `spreadScore`

Écart Δ = P90 − P10 des membres, converti en score : `s(Δ) = 100 · (1 − min(Δ / échelle, 1))`.

| Variable    | Échelle (score 0) | Poids |
| ----------- | ----------------- | ----- |
| Température | 8 °C              | 0,30  |
| Vent        | 25 km/h           | 0,35  |
| Pluie       | 5 mm/h            | 0,35  |

Pour la pluie, on multiplie en plus par un **facteur de partage** : avec `p` la part de membres prévoyant > 0,1 mm/h,
`f(p) = 1 − 0,8 · 4p(1 − p)`. Ensemble unanime (p = 0 ou 1) → 1 ; partagé 50/50 → 0,2.
Une variable n'est comptée qu'avec au moins 2 valeurs ; les poids sont renormalisés sur les variables présentes.

### 2. Accord entre modèles — `agreementScore`

Même calcul avec Δ = max − min des 4 modèles déterministes (et le même facteur de partage pour la pluie).

### 3. Échéance — `leadTimeScore(j)`

Fonction continue, monotone décroissante, linéaire par morceaux entre ces ancres (j = jours entre maintenant et l'ETA) :

| J     | 0   | 1   | 3   | 5   | 7   | 10  | 14  | ≥ 16 |
| ----- | --- | --- | --- | --- | --- | --- | --- | ---- |
| score | 100 | 95  | 85  | 65  | 45  | 25  | 10  | 5    |

Échéance négative ou nulle → 100.

### 4. Combinaison

```
score = 0,4 · spread + 0,3 · agreement + 0,3 · lead
```

Si une source manque, les poids sont **renormalisés** sur les composantes disponibles (ex. sans ensemble : `(0,3·agreement + 0,3·lead) / 0,6` ; sans rien : `lead`). Dans `PointConfidence`, un sous-score indisponible est rempli avec la valeur `lead` (pour l'affichage uniquement).

### Plages (`temperature`, `windSpeed`, `precipitation`)

`{ low, mid, high }` = P10 / médiane / P90 des membres ; à défaut min / médiane / max des modèles ; à défaut la valeur déterministe de la prévision principale (low = mid = high).

## Score global

Moyenne des scores des points pondérée par la longueur de trace que représente chaque échantillon (moitié de la distance au précédent + moitié au suivant).

| Niveau   | Seuil |
| -------- | ----- |
| `high`   | ≥ 70  |
| `medium` | ≥ 45  |
| `low`    | < 45  |

## Raisons affichées (2 à 4 phrases)

Générées par règles, dans cet ordre, puis tronquées à 3 + la phrase d'échéance (toujours présente) :

1. Ensemble, température : « Les membres de l'ensemble s'accordent à ±1,5 °C sur la température. » (demi-écart P10–P90 moyen ≤ 2 °C), sinon « Forte dispersion… ».
2. Modèles : « Désaccord entre modèles sur la pluie vers 14 h (km 85). » (écart ≥ 1 mm/h, ou modèles partagés pluie/sec avec écart ≥ 0,3), sinon « Écart de X °C entre modèles… » (≥ 3 °C), sinon « Les 4 modèles (ECMWF, ICON, GFS, Météo-France) concordent. ».
3. Ensemble, pluie : « L'ensemble hésite sur la pluie vers 14 h (50 % des membres en prévoient). » (25–75 % des membres).
4. Ensemble, vent : « Vent incertain : jusqu'à X km/h d'écart entre membres. » (≥ 12 km/h).
5. Aucune donnée : « Données d'ensemble et multi-modèles indisponibles : indice fondé sur l'échéance seule. »
6. Échéance : « Échéance courte (moins de 24 h) : prévision fiable. » / « Échéance J+2 : prévision généralement fiable. » / « Échéance J+6 : fiabilité réduite. » (≥ 2,5 j) / « … fiabilité faible. » (≥ 7 j).

Heures affichées en Europe/Paris, arrondies à l'heure.

## Limites

- L'ensemble n'est interrogé qu'en 6 points : sur une très longue trace, la dispersion locale (relief, littoral) peut être lissée.
- Heure la plus proche, sans interpolation temporelle des membres.
- Résolution des ensembles (~25–40 km) : les phénomènes convectifs locaux (orages d'été) sont mal représentés ; la dispersion peut sous-estimer l'incertitude réelle.
- Les échelles (8 °C, 25 km/h, 5 mm/h) et les ancres d'échéance sont des choix empiriques, pas une calibration statistique.
- La direction du vent n'entre pas dans l'indice (seulement sa vitesse), alors qu'elle conditionne vent de face/dos.
- Au-delà de ~7 jours, ICON-EPS ne fournit plus de membres : l'ensemble se réduit à GEFS + ECMWF.
