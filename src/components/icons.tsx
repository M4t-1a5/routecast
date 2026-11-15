/** Icônes SVG inline (trait 1.8, 24×24, currentColor). */
import type { ReactNode, SVGProps } from 'react';
import type { GearAdvice } from '../types';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Logo = ({ size = 28, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" {...p}>
    <defs>
      <linearGradient id="rc-logo" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#38bdf8" />
        <stop offset="1" stopColor="#6366f1" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="9" fill="url(#rc-logo)" />
    <path
      d="M6 22.5c3.2 0 4-6 7.2-6s3.4 3.6 6.4 3.6S23.5 11 26 11"
      fill="none"
      stroke="#fff"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
    <circle cx="22.5" cy="8.8" r="2.6" fill="#fde68a" />
  </svg>
);

export const IconSun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);
export const IconMoon = (p: P) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </Svg>
);
export const IconDownload = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Svg>
);
export const IconShare = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v12M8 7l4-4 4 4" />
    <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IconPencil = (p: P) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" />
  </Svg>
);
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </Svg>
);
export const IconUpload = (p: P) => (
  <Svg {...p}>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
  </Svg>
);
export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path
      d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.6-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8Z"
      fill="currentColor"
      stroke="none"
    />
  </Svg>
);
export const IconPause = (p: P) => (
  <Svg {...p}>
    <rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
    <rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const IconSwap = (p: P) => (
  <Svg {...p}>
    <path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />
  </Svg>
);
export const IconMountain = (p: P) => (
  <Svg {...p}>
    <path d="m3 19 6.5-11 4 6.5 2.5-3.5L21 19H3Z" />
  </Svg>
);
export const IconInfo = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);
export const IconAlert = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 2 20h20L12 3Z" />
    <path d="M12 10v4M12 17h.01" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m5 12 5 5 9-10" />
  </Svg>
);
export const IconHistory = (p: P) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 8v4l3 2" />
  </Svg>
);
export const IconBike = (p: P) => (
  <Svg {...p}>
    <circle cx="5.5" cy="16.5" r="3.5" />
    <circle cx="18.5" cy="16.5" r="3.5" />
    <path d="M5.5 16.5 9 9h6l3.5 7.5M12 16.5 9 9M15 9l-1.5-3H11" />
  </Svg>
);
export const IconRun = (p: P) => (
  <Svg {...p}>
    <circle cx="14.5" cy="4.5" r="1.8" />
    <path d="m8 20 3-5.5 3 2.5v4M6 11l3-3h4l2 4 3 1M11 14.5 13 8" />
  </Svg>
);
export const IconWind = (p: P) => (
  <Svg {...p}>
    <path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7" />
  </Svg>
);
export const IconDrop = (p: P) => (
  <Svg {...p}>
    <path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11Z" />
  </Svg>
);
export const IconThermo = (p: P) => (
  <Svg {...p}>
    <path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0Z" />
  </Svg>
);
export const IconGauge = (p: P) => (
  <Svg {...p}>
    <path d="M4 18a8 8 0 1 1 16 0" />
    <path d="m12 18 4-6" />
  </Svg>
);
export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const IconFile = (p: P) => (
  <Svg {...p}>
    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z" />
    <path d="M14 3v5h5" />
  </Svg>
);

/** Flèche de vent : pointe dans le sens où le vent SOUFFLE (direction météo + 180°). */
export const WindArrow = ({ deg, ...p }: P & { deg: number }) => (
  <Svg {...p} style={{ transform: `rotate(${deg + 180}deg)`, ...(p.style ?? {}) }}>
    <path d="M12 20V4M6.5 9.5 12 4l5.5 5.5" />
  </Svg>
);

/* ----------------------------- Météo (WMO) ----------------------------- */

export function WeatherIcon({ code, isDay = true, size = 20, ...p }: P & { code: number; isDay?: boolean }) {
  const sun = (
    <g stroke="#fbbf24">
      <circle cx="9" cy="9" r="3.4" fill="#fbbf24" />
      <path d="M9 2.5v1.3M9 14.2v1.3M2.5 9h1.3M14.2 9h1.3M4.4 4.4l.9.9M12.7 12.7l.9.9M4.4 13.6l.9-.9M12.7 5.3l.9-.9" />
    </g>
  );
  const moon = <path d="M13 11.5A5 5 0 0 1 7 4.6a5 5 0 1 0 6 6.9Z" fill="#c7d2fe" stroke="#c7d2fe" />;
  const cloud = (fill = '#e2e8f0') => (
    <path
      d="M7.5 19h9a3.6 3.6 0 0 0 .4-7.2A5 5 0 0 0 7.3 12 3.5 3.5 0 0 0 7.5 19Z"
      fill={fill}
      stroke="#94a3b8"
      strokeWidth={1.2}
    />
  );
  const drops = (
    <g stroke="#60a5fa" strokeWidth={1.8}>
      <path d="M9 20.5 8 22.5M13 20.5l-1 2M17 20.5l-1 2" />
    </g>
  );
  let body: ReactNode;
  if (code === 0)
    body = isDay ? <g transform="translate(3 3)">{sun}</g> : <g transform="translate(3 3)">{moon}</g>;
  else if (code <= 2)
    body = (
      <>
        {isDay ? sun : moon}
        {cloud()}
      </>
    );
  else if (code === 3) body = cloud('#cbd5e1');
  else if (code <= 48)
    body = (
      <g stroke="#94a3b8" strokeWidth={2}>
        <path d="M4 9h16M3 13h18M5 17h14" />
      </g>
    );
  else if (code <= 67 || (code >= 80 && code <= 82))
    body = (
      <g transform="translate(0 -2)">
        {cloud('#cbd5e1')}
        {drops}
      </g>
    );
  else if (code <= 77 || code <= 86)
    body = (
      <g transform="translate(0 -2)">
        {cloud('#e2e8f0')}
        <g fill="#e0f2fe" stroke="#93c5fd" strokeWidth={1}>
          <circle cx="9" cy="21.5" r="1.1" />
          <circle cx="13" cy="22" r="1.1" />
          <circle cx="17" cy="21.5" r="1.1" />
        </g>
      </g>
    );
  else
    body = (
      <g transform="translate(0 -2)">
        {cloud('#94a3b8')}
        <path d="m12.5 18.5-2 3.5h3l-2 3" stroke="#facc15" strokeWidth={1.8} fill="none" />
      </g>
    );
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...p}
    >
      {body}
    </svg>
  );
}

/* --------------------------- Équipement --------------------------- */

export function GearIcon({ id, ...p }: P & { id: GearAdvice }) {
  switch (id) {
    case 'windbreaker':
      return <IconWind {...p} />;
    case 'rain-jacket':
      return (
        <Svg {...p}>
          <path d="M3 12a9 9 0 0 1 18 0H3ZM12 12v6a2 2 0 0 1-4 0" />
        </Svg>
      );
    case 'arm-warmers':
    case 'leg-warmers':
      return (
        <Svg {...p}>
          <path d="M9 3h6l-1 18h-4L9 3ZM9.4 8h5.2M9.8 14h4.4" />
        </Svg>
      );
    case 'gloves':
      return (
        <Svg {...p}>
          <path d="M7 21v-6L5 10.5a1.5 1.5 0 0 1 2.6-1.5L9 11V5a1.5 1.5 0 0 1 3 0v5-6a1.5 1.5 0 0 1 3 0v6-4a1.5 1.5 0 0 1 3 0v8c0 3-2 5-4 6v1" />
        </Svg>
      );
    case 'winter-layers':
      return (
        <Svg {...p}>
          <path d="M12 2v20M4 6l16 12M20 6 4 18M9 3.5l3 2 3-2M9 20.5l3-2 3 2" />
        </Svg>
      );
    case 'lights':
      return (
        <Svg {...p}>
          <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" />
        </Svg>
      );
    case 'sunscreen':
      return <IconSun {...p} />;
    case 'extra-water':
      return <IconDrop {...p} />;
    default:
      return <IconInfo {...p} />;
  }
}
