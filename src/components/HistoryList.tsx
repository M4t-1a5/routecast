import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { useApp } from '../store/useApp';
import { openStoredRoute, removeStoredRoute, renameRoute } from '../store/actions';
import { fmtDateShort, fmtKm, fmtM } from '../lib/format';
import { toast } from '../lib/toast';
import { IconBike, IconCheck, IconClose, IconPencil, IconRun, IconTrash } from './icons';
import { cx } from '../lib/cx';
import type { StoredRoute } from '../types';

function Row({ item }: { item: StoredRoute }) {
  const { route } = item;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(route.name);
  const [confirm, setConfirm] = useState(false);

  const commit = async () => {
    setEditing(false);
    if (name.trim() && name.trim() !== route.name) await renameRoute(route.id, name);
    else setName(route.name);
  };

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="group relative flex items-center gap-2 rounded-2xl bg-tile pr-1.5 transition-colors hover:bg-tile-hover"
    >
      {editing ? (
        <form
          className="flex flex-1 items-center gap-2 py-2 pl-3"
          onSubmit={(e) => {
            e.preventDefault();
            void commit();
          }}
        >
          <label className="sr-only" htmlFor={`rn-${route.id}`}>
            Nouveau nom
          </label>
          <input
            id={`rn-${route.id}`}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setName(route.name);
                setEditing(false);
              }
            }}
            className="focus-ring min-w-0 flex-1 rounded-lg border border-line bg-transparent px-2 py-1 text-sm text-fg"
          />
          <button
            type="submit"
            aria-label="Valider le nom"
            className="focus-ring rounded-full p-1.5 text-fg-muted hover:text-fg"
          >
            <IconCheck size={16} />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => void openStoredRoute(route.id)}
          className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-2xl py-2.5 pl-3 text-left"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent-from/25 to-accent-to/25 text-sky-300">
            {route.sport === 'running' ? <IconRun size={16} /> : <IconBike size={16} />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-fg">{route.name}</span>
            <span className="tabular block text-xs text-fg-subtle">
              {fmtKm(route.stats.distance)} · D+ {fmtM(route.stats.ascent)} ·{' '}
              {fmtDateShort(item.lastOpenedAt)}
            </span>
          </span>
        </button>
      )}
      {!editing && !confirm && (
        <div className="flex opacity-100 transition-opacity lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
          <button
            type="button"
            aria-label={`Renommer ${route.name}`}
            title="Renommer"
            onClick={() => setEditing(true)}
            className="focus-ring rounded-full p-2 text-fg-subtle hover:bg-tile-hover hover:text-fg"
          >
            <IconPencil size={15} />
          </button>
          <button
            type="button"
            aria-label={`Supprimer ${route.name}`}
            title="Supprimer"
            onClick={() => setConfirm(true)}
            className="focus-ring rounded-full p-2 text-fg-subtle hover:bg-red-500/15 hover:text-red-400"
          >
            <IconTrash size={15} />
          </button>
        </div>
      )}
      {confirm && (
        <div role="group" aria-label="Confirmer la suppression" className="flex items-center gap-1 text-xs">
          <span className="text-fg-muted">Supprimer ?</span>
          <button
            type="button"
            autoFocus
            onClick={async () => {
              await removeStoredRoute(route.id);
              toast('Trace supprimée', 'success');
            }}
            className="focus-ring rounded-full bg-red-500/90 px-2.5 py-1 font-medium text-white hover:bg-red-500"
          >
            Oui
          </button>
          <button
            type="button"
            aria-label="Annuler"
            onClick={() => setConfirm(false)}
            className="focus-ring rounded-full p-1.5 text-fg-subtle hover:text-fg"
          >
            <IconClose size={14} />
          </button>
        </div>
      )}
    </motion.li>
  );
}

export default function HistoryList({ className, limit = 8 }: { className?: string; limit?: number }) {
  const history = useApp((s) => s.history);
  if (!history.length) return null;
  return (
    <ul className={cx('flex flex-col gap-1.5', className)} aria-label="Traces récentes">
      <AnimatePresence initial={false}>
        {history.slice(0, limit).map((h) => (
          <Row key={h.route.id} item={h} />
        ))}
      </AnimatePresence>
    </ul>
  );
}
