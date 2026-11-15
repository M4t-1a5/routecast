import { useRef, useState } from 'react';
import { useApp } from '../store/useApp';
import { closeRoute, renameRoute, updateSettings } from '../store/actions';
import { fmtPace } from '../lib/format';
import { fromLocalDateTime, nextWeekdayDate, toLocalDateTime, withDate } from '../lib/time';
import type { SpeedModel } from '../types';
import { IconBike, IconCheck, IconClose, IconInfo, IconPencil, IconRun, IconSwap } from './icons';
import { Section, Segmented, Switch } from './ui';
import { cx } from '../lib/cx';

const POWER_DEFAULT = { kind: 'power', powerW: 200, massKg: 82, cda: 0.32, crr: 0.0045 } as const;
type Kind = SpeedModel['kind'];

/** Dernières valeurs par mode, pour ne pas les perdre en changeant de mode. */
const memory: Partial<Record<Kind, SpeedModel>> = {};

function defaultModel(kind: Kind): SpeedModel {
  if (memory[kind]) return memory[kind]!;
  switch (kind) {
    case 'fixed':
      return { kind: 'fixed', speedKmh: 25 };
    case 'power':
      return { ...POWER_DEFAULT };
    case 'run':
      return { kind: 'run', paceSecPerKm: 330 };
    default:
      return { kind: 'replay' };
  }
}

const inputCls =
  'focus-ring tabular w-full rounded-xl border border-line bg-tile px-3 py-2 text-sm text-fg placeholder:text-fg-subtle';

function NumberField({
  label,
  value,
  onChange,
  step,
  min,
  max,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  min: number;
  max: number;
  unit?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-fg-subtle">{label}</span>
      <span className="relative block">
        <input
          type="number"
          inputMode="decimal"
          className={cx(inputCls, unit && 'pr-10')}
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
          }}
        />
        {unit && (
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-fg-subtle">
            {unit}
          </span>
        )}
      </span>
    </label>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <span className="mb-2 flex items-baseline justify-between">
        <span className="text-xs text-fg-subtle">{label}</span>
        <span className="tabular text-sm font-semibold text-fg">{display}</span>
      </span>
      <input
        type="range"
        className="rc-range w-full"
        style={{ ['--rc-fill' as string]: `${pct}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={display}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function TrackName() {
  const route = useApp((s) => s.baseRoute);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  if (!route) return null;
  const commit = () => {
    setEditing(false);
    void renameRoute(route.id, name);
  };
  return (
    <div className="flex items-center gap-2 px-4 pt-1 pb-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent-from/30 to-accent-to/30 text-sky-300">
        {route.sport === 'running' ? <IconRun size={18} /> : <IconBike size={18} />}
      </span>
      {editing ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
        >
          <label htmlFor="track-name" className="sr-only">
            Nom de la trace
          </label>
          <input
            id="track-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
            className={cx(inputCls, 'py-1.5 font-semibold')}
          />
          <button
            type="submit"
            aria-label="Valider"
            className="focus-ring rounded-full p-1.5 text-fg-muted hover:text-fg"
          >
            <IconCheck size={16} />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setName(route.name);
            setEditing(true);
          }}
          className="focus-ring group flex min-w-0 flex-1 items-center gap-1.5 rounded-lg text-left"
          title="Renommer la trace"
        >
          <span className="truncate text-[17px] leading-tight font-semibold">{route.name}</span>
          <IconPencil size={14} className="shrink-0 text-fg-subtle opacity-60 group-hover:opacity-100" />
          <span className="sr-only">(renommer)</span>
        </button>
      )}
      <button
        type="button"
        onClick={closeRoute}
        aria-label="Fermer la trace et en choisir une autre"
        title="Changer de trace"
        className="focus-ring rounded-full p-2 text-fg-subtle hover:bg-tile-hover hover:text-fg"
      >
        <IconClose size={16} />
      </button>
    </div>
  );
}

function StartPicker() {
  const startTime = useApp((s) => s.settings.startTime);
  const tz = useApp((s) => s.settings.timezone || 'Europe/Paris');
  const local = toLocalDateTime(startTime, tz);
  const now = Date.now();
  const today = toLocalDateTime(now, tz).date;
  const sat = nextWeekdayDate(now, 6, tz);
  const sun = nextWeekdayDate(now, 0, tz);
  const shortcuts = [
    { label: "Aujourd'hui", date: today },
    { label: 'Samedi', date: sat },
    { label: 'Dimanche', date: sun },
  ];
  const timeRef = useRef(local.time);
  timeRef.current = local.time;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1.4fr_1fr] gap-2">
        <label className="block">
          <span className="mb-1 block text-xs text-fg-subtle">Date de départ</span>
          <input
            type="date"
            className={inputCls}
            value={local.date}
            min={today}
            onChange={(e) => {
              const ms = fromLocalDateTime(e.target.value, timeRef.current, tz);
              if (Number.isFinite(ms)) updateSettings({ startTime: ms }, true);
            }}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-fg-subtle">Heure</span>
          <input
            type="time"
            step={300}
            className={inputCls}
            value={local.time}
            onChange={(e) => {
              const ms = fromLocalDateTime(local.date, e.target.value, tz);
              if (Number.isFinite(ms)) updateSettings({ startTime: ms });
            }}
          />
        </label>
      </div>
      <div className="flex gap-1.5" role="group" aria-label="Raccourcis de date">
        {shortcuts.map((s) => {
          const on = s.date === local.date;
          return (
            <button
              key={s.label}
              type="button"
              aria-pressed={on}
              onClick={() => updateSettings({ startTime: withDate(startTime, s.date, tz) }, true)}
              className={cx(
                'focus-ring rounded-full px-3 py-1 text-xs font-medium transition-colors',
                on ? 'bg-accent text-white' : 'bg-tile text-fg-muted hover:bg-tile-hover hover:text-fg',
              )}
            >
              {s.label}
            </button>
          );
        })}
        <span className="ml-auto self-center text-[11px] text-fg-subtle">Heure de Paris</span>
      </div>
    </div>
  );
}

function SpeedModelEditor() {
  const model = useApp((s) => s.settings.speedModel);
  const route = useApp((s) => s.baseRoute);
  const reversed = useApp((s) => s.settings.reversed);
  const [help, setHelp] = useState(false);
  const set = (m: SpeedModel, immediate = false) => {
    memory[m.kind] = m;
    updateSettings({ speedModel: m }, immediate);
  };

  const options: { value: Kind; label: string; title?: string }[] = [
    { value: 'fixed', label: 'Vitesse' },
    { value: 'power', label: 'Puissance' },
  ];
  if (route?.hasRecordedTime)
    options.push({ value: 'replay', label: 'Rejouer', title: 'Rejouer ma vitesse enregistrée' });
  options.push({ value: 'run', label: 'Course' });

  return (
    <div className="space-y-3">
      <Segmented
        label="Modèle de vitesse"
        value={model.kind}
        options={options}
        onChange={(k) => k !== model.kind && set(defaultModel(k), true)}
        size="sm"
      />
      {model.kind === 'fixed' && (
        <Range
          label="Vitesse moyenne sur le plat"
          value={model.speedKmh}
          min={8}
          max={50}
          step={0.5}
          display={`${model.speedKmh.toLocaleString('fr-FR')} km/h`}
          onChange={(v) => set({ kind: 'fixed', speedKmh: v })}
        />
      )}
      {model.kind === 'run' && (
        <Range
          label="Allure sur le plat"
          value={model.paceSecPerKm}
          min={150}
          max={600}
          step={5}
          display={fmtPace(model.paceSecPerKm)}
          onChange={(v) => set({ kind: 'run', paceSecPerKm: v })}
        />
      )}
      {model.kind === 'replay' && (
        <p className="rounded-xl bg-tile px-3 py-2 text-xs text-fg-muted">
          {reversed
            ? "Le rejeu n'est pas possible en sens inverse : une vitesse fixe de 25 km/h est utilisée."
            : 'Les temps de passage reprennent votre enregistrement, décalés à la nouvelle heure de départ.'}
        </p>
      )}
      {model.kind === 'power' && (
        <div className="space-y-2">
          <Range
            label="Puissance moyenne"
            value={model.powerW}
            min={60}
            max={450}
            step={5}
            display={`${model.powerW} W`}
            onChange={(v) => set({ ...model, powerW: v })}
          />
          <div className="grid grid-cols-3 gap-2">
            <NumberField
              label="Masse totale"
              unit="kg"
              value={model.massKg}
              min={30}
              max={200}
              step={1}
              onChange={(v) => set({ ...model, massKg: v })}
            />
            <NumberField
              label="CdA"
              unit="m²"
              value={model.cda}
              min={0.15}
              max={0.8}
              step={0.01}
              onChange={(v) => set({ ...model, cda: v })}
            />
            <NumberField
              label="Crr"
              value={model.crr}
              min={0.001}
              max={0.02}
              step={0.0005}
              onChange={(v) => set({ ...model, crr: v })}
            />
          </div>
          <button
            type="button"
            aria-expanded={help}
            onClick={() => setHelp(!help)}
            className="focus-ring flex items-center gap-1 rounded text-xs text-sky-500 hover:underline dark:text-sky-300"
          >
            <IconInfo size={14} /> Comment choisir ces valeurs ?
          </button>
          {help && (
            <div className="space-y-1 rounded-xl bg-tile px-3 py-2 text-xs leading-relaxed text-fg-muted">
              <p>
                <b className="text-fg">Masse totale</b> : vous + vélo + équipement (≈ poids + 9 kg).
              </p>
              <p>
                <b className="text-fg">CdA</b> (traînée aérodynamique) : 0,25 position aéro, 0,32 mains en bas
                du cintre, 0,40 position relevée.
              </p>
              <p>
                <b className="text-fg">Crr</b> (résistance au roulement) : 0,003 pneus route haut de gamme,
                0,0045 standard, 0,008 gravel.
              </p>
              <p>
                Le vent prévu est pris en compte à chaque point : la vitesse baisse face au vent, augmente
                vent dans le dos.
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={() => set({ ...POWER_DEFAULT }, true)}
            className="focus-ring rounded text-xs text-fg-subtle hover:text-fg"
          >
            Valeurs par défaut (200 W, 82 kg, 0,32, 0,0045)
          </button>
        </div>
      )}
    </div>
  );
}

/** Panneau « Trace & réglages ». */
export default function TrackPanel() {
  const reversed = useApp((s) => s.settings.reversed);
  return (
    <div>
      <TrackName />
      <Section title="Départ">
        <StartPicker />
      </Section>
      <Section title="Allure">
        <SpeedModelEditor />
      </Section>
      <div className="px-4 pt-1 pb-3">
        <div className="flex items-center gap-3 rounded-2xl bg-tile px-3 py-2.5">
          <IconSwap size={18} className="text-fg-subtle" />
          <div className="flex-1">
            <Switch
              checked={reversed}
              onChange={(v) => updateSettings({ reversed: v }, true)}
              label="Inverser le sens"
              description="Parcourir la boucle dans l'autre sens"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
