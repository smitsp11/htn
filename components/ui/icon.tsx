export type IconName =
  | "grid"
  | "inbox"
  | "check"
  | "shield"
  | "search"
  | "arrow"
  | "chevron"
  | "download"
  | "clock"
  | "building"
  | "info"
  | "x"
  | "filter"
  | "menu"
  | "ask"
  | "globe"
  | "copy"
  | "alert"
  | "book"
  | "north-star";

/**
 * `d` (or nested-path markup, for icons with more than one <path>) copied verbatim from
 * federanorth's `paths` map (`src/decision/dashboard.js`) and its north-star brand glyph
 * (`src/decision/federanorth-shell.js`). Every entry below traces to that source — none are
 * placeholders.
 */
const PATHS: Record<IconName, string> = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  inbox: '<path d="m4 4-2 11v5h20v-5L20 4H4Z"/><path d="M2 15h6l2 3h4l2-3h6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  building: '<path d="M4 21V7l8-4v18m0-13h8v13M2 21h20M7 9v2m0 3v2m9-4v2m0 3v2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  filter: '<path d="M4 7h16M7 12h10m-7 5h4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  ask: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M12 13v.01M12 7v3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  alert: '<path d="M12 4 2 20h20L12 4Z"/><path d="M12 10v4m0 3v.01"/>',
  book: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/>',
  "north-star": '<path d="M20 0c1.9 13.5 6.5 18.1 20 20-13.5 1.9-18.1 6.5-20 20C18.1 26.5 13.5 21.9 0 20 13.5 18.1 18.1 13.5 20 0Z"/>',
};

export interface IconProps {
  name: IconName;
  className?: string;
}

export function Icon({ name, className }: IconProps) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
