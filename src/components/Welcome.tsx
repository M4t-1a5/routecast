import { motion } from 'framer-motion';
import { useRef, useState } from 'react';
import { useApp } from '../store/useApp';
import { importFile, loadDemo } from '../store/actions';
import HistoryList from './HistoryList';
import { IconBike, IconClock, IconFile, IconHistory, IconUpload, IconWind, Logo } from './icons';
import { Button } from './ui';
import { cx } from '../lib/cx';

/** Écran d'accueil (aucune trace ouverte). La carte reste visible en fond, floutée. */
export default function Welcome() {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const loading = useApp((s) => s.importStatus === 'loading');
  const hasHistory = useApp((s) => s.history.length > 0);

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-slate-950/45 backdrop-blur-[6px]">
      <div className="flex min-h-full items-center justify-center p-4 py-10">
        <motion.main
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          className="glass w-full max-w-[560px] rounded-[28px] p-6 text-fg sm:p-8"
          aria-labelledby="welcome-title"
        >
          <div className="mb-6 flex items-center gap-3">
            <Logo size={40} />
            <div>
              <h1 id="welcome-title" className="text-2xl font-semibold tracking-tight">
                RouteCast
              </h1>
              <p className="text-sm text-fg-muted">
                La météo de votre sortie, au bon endroit, au bon moment.
              </p>
            </div>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={() => setOver(false)}
            className={cx(
              'relative flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed px-6 py-8 text-center transition-colors',
              over ? 'border-sky-400 bg-sky-400/10' : 'border-line bg-tile',
            )}
          >
            <motion.div
              animate={over ? { y: -4, scale: 1.06 } : { y: 0, scale: 1 }}
              className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-from to-accent-to text-white shadow-lg shadow-indigo-500/25"
            >
              <IconUpload size={26} />
            </motion.div>
            <div>
              <div className="font-medium">Glissez-déposez votre trace ici</div>
              <div className="text-sm text-fg-subtle">GPX ou FIT (Strava, Komoot, Garmin…)</div>
            </div>
            <input
              ref={input}
              type="file"
              accept=".gpx,.fit"
              className="sr-only"
              id="welcome-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = '';
              }}
            />
            <Button variant="primary" onClick={() => input.current?.click()} disabled={loading}>
              <IconFile size={16} />
              {loading ? 'Chargement…' : 'Choisir un fichier .gpx / .fit'}
            </Button>
          </div>

          <div className="mt-3 flex justify-center">
            <Button
              variant="ghost"
              onClick={() => void loadDemo()}
              disabled={loading}
              className="text-sky-500 dark:text-sky-300"
            >
              <IconBike size={16} />
              Essayer avec la démo (Houilles – Vallée de Chevreuse)
            </Button>
          </div>

          {hasHistory && (
            <div className="mt-6">
              <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">
                <IconHistory size={14} /> Traces récentes
              </h2>
              <HistoryList />
            </div>
          )}

          <ul className="mt-6 grid gap-3 text-sm text-fg-muted sm:grid-cols-3">
            <li className="flex gap-2">
              <IconClock size={18} className="mt-0.5 shrink-0 text-sky-400" />
              <span>Chaque point de la trace reçoit la prévision de l'heure où vous y passerez.</span>
            </li>
            <li className="flex gap-2">
              <IconWind size={18} className="mt-0.5 shrink-0 text-sky-400" />
              <span>
                Vent de face ou de dos, pluie, température, montées : tout est sur la carte et le profil.
              </span>
            </li>
            <li className="flex gap-2">
              <IconHistory size={18} className="mt-0.5 shrink-0 text-sky-400" />
              <span>
                Vos traces restent sur cet appareil. Rien n'est envoyé hormis les coordonnées à Open-Meteo.
              </span>
            </li>
          </ul>
        </motion.main>
      </div>
    </div>
  );
}
