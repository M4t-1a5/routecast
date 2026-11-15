import type { ThemeMode } from '../../types';

/** Panneau glassmorphism (selon le thème du store, indépendant de la stratégie `dark:` de Tailwind). */
export function glass(theme: ThemeMode): string {
  return theme === 'dark'
    ? 'bg-black/30 text-white border border-white/15 backdrop-blur-xl rounded-2xl shadow-lg shadow-black/30'
    : 'bg-white/70 text-slate-900 border border-black/10 backdrop-blur-xl rounded-2xl shadow-lg shadow-black/10';
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
