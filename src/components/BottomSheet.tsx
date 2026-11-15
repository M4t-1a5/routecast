import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
  type PanInfo,
} from 'framer-motion';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../store/useApp';
import { cx } from '../lib/cx';

export type Snap = 'collapsed' | 'mid' | 'full';
const TOP_GAP = 56; // la carte garde ses contrôles en haut
const COLLAPSED = 172; // hauteur visible repliée (poignée + en-tête + stats clés)

function useViewportHeight() {
  const [h, setH] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800));
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return h;
}

/** Bottom sheet glissable (3 crans). `peek` = contenu toujours visible (zone de saisie du geste). */
export default function BottomSheet({ peek, children }: { peek: ReactNode; children: ReactNode }) {
  const vh = useViewportHeight();
  const height = vh - TOP_GAP;
  const snaps: Record<Snap, number> = {
    full: 0,
    mid: Math.round(height * 0.48),
    collapsed: height - COLLAPSED,
  };
  const [snap, setSnap] = useState<Snap>('collapsed');
  const y = useMotionValue(snaps.collapsed);
  const controls = useDragControls();
  const reduce = useReducedMotion();
  const setSheetOpen = useCallback((open: boolean) => useApp.getState().set({ sheetOpen: open }), []);
  const scroller = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (s: Snap) => {
      setSnap(s);
      setSheetOpen(s !== 'collapsed');
      const target = {
        full: 0,
        mid: Math.round((window.innerHeight - TOP_GAP) * 0.48),
        collapsed: window.innerHeight - TOP_GAP - COLLAPSED,
      }[s];
      if (reduce) y.set(target);
      else animate(y, target, { type: 'spring', stiffness: 420, damping: 42 });
      if (s === 'collapsed') scroller.current?.scrollTo({ top: 0 });
    },
    [reduce, y, setSheetOpen],
  );

  // Recalage si la fenêtre change de taille
  useEffect(() => {
    go(snap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vh]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const cur = y.get();
    const projected = cur + info.velocity.y * 0.18;
    const order: Snap[] = ['full', 'mid', 'collapsed'];
    let best: Snap = 'collapsed';
    let bestD = Infinity;
    for (const s of order) {
      const d = Math.abs(snaps[s] - projected);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    go(best);
  };

  const cycle = () => go(snap === 'collapsed' ? 'mid' : snap === 'mid' ? 'full' : 'collapsed');
  const label = { collapsed: 'replié', mid: 'à mi-hauteur', full: 'déplié' }[snap];

  return (
    <motion.section
      aria-label="Détails de la sortie"
      className="glass-strong fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-[26px] border-b-0! text-fg"
      style={{ height, y, touchAction: 'none' }}
      drag="y"
      dragControls={controls}
      dragListener={false}
      dragConstraints={{ top: snaps.full, bottom: snaps.collapsed }}
      dragElastic={0.08}
      dragMomentum={false}
      onDragEnd={onDragEnd}
    >
      <div
        className="shrink-0 cursor-grab touch-none px-3 pb-2 active:cursor-grabbing"
        onPointerDown={(e) => controls.start(e)}
      >
        <button
          type="button"
          onClick={cycle}
          aria-label={`Panneau ${label}. Activer pour changer la hauteur`}
          aria-expanded={snap !== 'collapsed'}
          className="focus-ring mx-auto my-2 block h-5 w-16 rounded-full"
        >
          <span className="mx-auto block h-1.5 w-10 rounded-full bg-fg-subtle/50" />
        </button>
        {peek}
      </div>
      <div
        ref={scroller}
        className={cx(
          'scroll-thin min-h-0 flex-1 overscroll-contain pb-[max(16px,env(safe-area-inset-bottom))]',
          snap === 'collapsed' ? 'overflow-hidden' : 'overflow-y-auto',
        )}
        style={{ touchAction: 'pan-y' }}
      >
        {children}
      </div>
    </motion.section>
  );
}
