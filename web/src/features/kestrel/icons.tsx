// Line icons for the Kestrel panel (24px grid, stroke follows currentColor).
const PATHS = {
  sidebar: 'M4 5h16v14H4zM9 5v14',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM20 20l-4-4',
  width: 'M4 12h16M7 9l-3 3l3 3M17 9l3 3l-3 3',
  dock: 'M4 5h16v14H4zM4 14h16',
  popout: 'M4 5h16v14H4zM14 5v14',
  close: 'M6 6l12 12M18 6L6 18',
  clip: 'M15 7l-6.5 6.5a2 2 0 0 0 3 3L18 10a4 4 0 0 0-6-6l-6.5 6.5a6 6 0 0 0 9 9L20 14',
  up: 'M12 19V5M6 11l6-6l6 6',
  stop: 'M7 7h10v10H7z',
  globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18',
  spark: 'M12 3l2 5l5 2l-5 2l-2 5l-2-5l-5-2l5-2z',
  target: 'M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16zM12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z',
  chevron: 'M6 9l6 6l6-6',
  check: 'M5 12l5 5l9-10',
  x: 'M7 7l10 10M17 7L7 17',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
  collapse: 'M6 15l6-6l6 6',
  expand: 'M6 9l6 6l6-6',
  trend: 'M3 17l6-6l4 4l8-8M15 7h6v6',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  chat: 'M5 5h14v10H9l-4 4z',
  slash: 'M15 4L9 20',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
} as const;
export type IconName = keyof typeof PATHS;
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="kx-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={PATHS[name]} /></svg>
  );
}
