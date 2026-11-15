import { AnimatePresence, motion } from 'framer-motion';
import { useApp } from '../store/useApp';
import { useToasts } from '../lib/toast';
import { IconAlert, IconCheck, IconClose, IconInfo } from './icons';
import { cx } from '../lib/cx';

/** Toasts éphémères + bannière d'erreur persistante (store.error). */
export default function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  const error = useApp((s) => s.error);
  const clearError = useApp((s) => s.clearError);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4 lg:top-4">
      <AnimatePresence>
        {error && (
          <motion.div
            key={`err-${error.kind}-${error.message}`}
            role="alert"
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="glass-strong pointer-events-auto flex w-full max-w-lg items-start gap-3 rounded-2xl border-red-400/40! px-4 py-3 text-sm text-fg"
          >
            <span className="mt-0.5 text-red-400">
              <IconAlert />
            </span>
            <div className="flex-1">
              <div className="font-semibold">
                {error.kind === 'invalid-file'
                  ? 'Fichier invalide'
                  : error.kind === 'api'
                    ? 'Service météo indisponible'
                    : error.kind === 'too-far'
                      ? 'Date trop lointaine'
                      : error.kind === 'past'
                        ? 'Date passée'
                        : error.kind === 'storage'
                          ? 'Stockage local'
                          : 'Erreur'}
              </div>
              <div className="text-fg-muted">{error.message}</div>
            </div>
            <button
              type="button"
              onClick={clearError}
              aria-label="Fermer le message d'erreur"
              className="focus-ring -mr-1 rounded-full p-1 text-fg-subtle hover:bg-tile-hover hover:text-fg"
            >
              <IconClose size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.button
              type="button"
              key={t.id}
              layout
              onClick={() => dismiss(t.id)}
              initial={{ opacity: 0, y: -12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="glass-strong pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-fg"
            >
              <span
                className={cx(
                  t.kind === 'success'
                    ? 'text-green-400'
                    : t.kind === 'error'
                      ? 'text-red-400'
                      : 'text-sky-400',
                )}
              >
                {t.kind === 'success' ? (
                  <IconCheck size={16} />
                ) : t.kind === 'error' ? (
                  <IconAlert size={16} />
                ) : (
                  <IconInfo size={16} />
                )}
              </span>
              {t.message}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
