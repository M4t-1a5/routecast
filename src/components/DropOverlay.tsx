import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { importFile } from '../store/actions';
import { IconUpload } from './icons';

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

/** Glisser-déposer global : overlay plein écran au survol de fichiers, import au dépôt. */
export default function DropOverlay() {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    };
    const overFn = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) void importFile(f);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', overFn);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <AnimatePresence>
      {over && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-6 backdrop-blur-md"
          aria-hidden="true"
        >
          <motion.div
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            className="flex w-full max-w-xl flex-col items-center gap-3 rounded-[28px] border-2 border-dashed border-sky-300/70 bg-sky-400/10 px-8 py-14 text-center text-white"
          >
            <IconUpload size={40} />
            <div className="text-xl font-semibold">Déposez votre trace</div>
            <div className="text-sm text-white/75">
              Fichier .gpx ou .fit — la météo sera calculée à votre heure de passage
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
