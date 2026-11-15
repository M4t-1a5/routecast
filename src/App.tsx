// OWNER: agent UI
import { MotionConfig } from 'framer-motion';
import { useEffect } from 'react';
import MapView from './features/map/MapView';
import ElevationProfile from './features/profile/ElevationProfile';
import { buildRoute } from './features/route';
import { useApp } from './store/useApp';
import { openRoute, refreshHistory, restorePrefs, setPendingSharedSettings } from './store/actions';
import { decodeShareState, shareSettings, shareToParsedTrack } from './lib/share';
import { toast } from './lib/toast';
import { useIsDesktop } from './lib/useMediaQuery';
import { usePlayback } from './lib/usePlayback';
import BottomSheet from './components/BottomSheet';
import DeparturesPanel from './components/DeparturesPanel';
import DropOverlay from './components/DropOverlay';
import Header, { ThemeToggle } from './components/Header';
import StatsGrid, { ConfidenceBadge, HorizonWarning } from './components/StatsGrid';
import SummaryPanel, { Climbs } from './components/SummaryPanel';
import Timeline from './components/Timeline';
import Toasts from './components/Toasts';
import TrackPanel from './components/TrackPanel';
import Welcome from './components/Welcome';
import { GlassPanel, Section } from './components/ui';

/** Lit un lien partagé (#s=...) et ouvre la trace / applique les réglages. */
async function applyShareLink() {
  const state = decodeShareState(window.location.hash);
  if (!state) return;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  const app = useApp.getState();
  app.setLayer(state.layer);
  const parsed = shareToParsedTrack(state);
  const settings = { ...shareSettings(state, app.settings.timezone || 'Europe/Paris') };
  if (parsed) {
    try {
      await openRoute(buildRoute(parsed), settings);
      toast('Trace partagée ouverte', 'success');
    } catch (e) {
      app.set({
        error: { kind: 'invalid-file', message: `Lien de partage illisible : ${(e as Error).message}` },
      });
    }
  } else {
    app.set({ settings: { ...app.settings, ...settings } });
    setPendingSharedSettings({ ...app.settings, ...settings });
    toast(
      `Le lien ne contient pas la trace « ${state.name} » (trop longue) : importez-la, les réglages partagés seront conservés.`,
      'info',
      8000,
    );
  }
}

function SidebarContent() {
  return (
    <>
      <TrackPanel />
      <div className="mx-4 border-t border-line" />
      <Section title="La sortie" action={<ConfidenceBadge />}>
        <StatsGrid />
      </Section>
      <HorizonWarning />
      <SummaryPanel />
      <Climbs />
      <DeparturesPanel />
      <p className="px-4 pt-2 pb-1 text-[10px] leading-relaxed text-fg-subtle">
        Prévisions{' '}
        <a className="underline hover:text-fg" href="https://open-meteo.com" target="_blank" rel="noreferrer">
          Open-Meteo
        </a>{' '}
        (CC BY 4.0) · Fond © OpenStreetMap
      </p>
    </>
  );
}

function DesktopLayout() {
  return (
    <>
      <GlassPanel
        className="fixed top-4 bottom-4 left-4 z-20 flex w-[392px] flex-col overflow-hidden"
        aria-label="Trace et réglages"
        role="complementary"
      >
        <Header />
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-3">
          <SidebarContent />
        </div>
      </GlassPanel>
      <div className="pointer-events-none fixed right-4 bottom-4 left-[424px] z-20 flex flex-col gap-3 [&>*]:pointer-events-auto">
        <Timeline />
        <GlassPanel className="h-[196px] overflow-hidden" data-export="profile" transition={{ delay: 0.06 }}>
          <ElevationProfile />
        </GlassPanel>
      </div>
    </>
  );
}

function MobileLayout() {
  return (
    <>
      <BottomSheet
        peek={
          <div>
            <Header compact />
            <StatsGrid compact />
          </div>
        }
      >
        <div className="space-y-3 px-3 pt-1 pb-3">
          <Timeline />
          <div className="h-[200px] overflow-hidden rounded-[20px] bg-tile" data-export="profile">
            <ElevationProfile />
          </div>
        </div>
        <div className="flex justify-end px-4">
          <ConfidenceBadge />
        </div>
        <SidebarContent />
      </BottomSheet>
    </>
  );
}

export default function App() {
  const theme = useApp((s) => s.theme);
  const hasRoute = useApp((s) => s.route != null);
  const desktop = useIsDesktop();
  usePlayback();

  useEffect(() => {
    void (async () => {
      await restorePrefs();
      await refreshHistory();
      await applyShareLink();
    })();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0b1020' : '#eef4ff');
  }, [theme]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="fixed inset-0">
        <MapView />
      </div>
      {hasRoute ? (
        desktop ? (
          <DesktopLayout />
        ) : (
          <MobileLayout />
        )
      ) : (
        <>
          <Welcome />
          <div className="glass fixed top-3 left-3 z-40 rounded-full p-0.5">
            <ThemeToggle />
          </div>
        </>
      )}
      <DropOverlay />
      <Toasts />
    </MotionConfig>
  );
}
