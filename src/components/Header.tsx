import { useState } from 'react';
import { useApp } from '../store/useApp';
import { buildShareUrl, shareStateFrom } from '../lib/share';
import { toast } from '../lib/toast';
import { IconDownload, IconMoon, IconShare, IconSun, Logo } from './icons';
import { IconButton } from './ui';
import { cx } from '../lib/cx';

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function ThemeToggle() {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const dark = theme === 'dark';
  return (
    <IconButton
      label={dark ? 'Passer en mode clair' : 'Passer en mode sombre'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      {dark ? <IconSun /> : <IconMoon />}
    </IconButton>
  );
}

/** En-tête : logo, thème, export PNG, partage. `compact` : version bottom sheet mobile (nom de la trace). */
export default function Header({ compact = false }: { compact?: boolean }) {
  const route = useApp((s) => s.baseRoute);
  const [busy, setBusy] = useState(false);

  const onShare = async () => {
    const s = useApp.getState();
    if (!s.baseRoute) return;
    const url = buildShareUrl(shareStateFrom(s.baseRoute, s.settings, s.layer), window.location.href);
    const ok = await copy(url);
    toast(ok ? 'Lien copié' : 'Impossible de copier le lien', ok ? 'success' : 'error');
  };

  const onExport = async () => {
    const s = useApp.getState();
    if (!s.route) return;
    setBusy(true);
    try {
      const { exportPng } = await import('../lib/export');
      await exportPng({
        route: s.route,
        startTime: s.settings.startTime,
        timing: s.timing,
        stats: s.stats,
        profileEl: document.querySelector<HTMLElement>('[data-export="profile"]'),
        dark: s.theme === 'dark',
      });
      toast('Image exportée', 'success');
    } catch (e) {
      toast(`Export impossible : ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className={cx('flex items-center gap-1', compact ? 'pb-2' : 'px-3 pt-3 pb-1')}>
      <div className="mr-auto flex min-w-0 items-center gap-2 pr-2">
        <Logo size={compact ? 26 : 30} className="shrink-0" />
        {compact && route ? (
          <span className="truncate text-[15px] font-semibold tracking-tight text-fg">{route.name}</span>
        ) : (
          <span className="text-[17px] font-semibold tracking-tight text-fg">RouteCast</span>
        )}
      </div>
      <ThemeToggle />
      {route && (
        <>
          <IconButton
            label="Exporter en PNG (carte + profil)"
            onClick={() => void onExport()}
            disabled={busy}
          >
            <IconDownload />
          </IconButton>
          <IconButton label="Copier le lien de partage" onClick={() => void onShare()}>
            <IconShare />
          </IconButton>
        </>
      )}
    </header>
  );
}
