import type { CSSProperties } from 'react';

/**
 * Minimal inline-SVG icon set for wireframes (zero JS, theme-aware via
 * `currentColor`). Mirrors the agent-native `data-icon` marker names.
 * Unknown names render a neutral placeholder box so layouts never break.
 */
export type IconName =
  | 'mail' | 'lock' | 'search' | 'plus' | 'x' | 'check'
  | 'chevronDown' | 'chevronRight' | 'more' | 'user' | 'settings'
  | 'calendar' | 'bell' | 'send' | 'edit' | 'arrowRight';

const P: Record<IconName, string> = {
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  lock: 'M6 10V8a6 6 0 1 1 12 0v2M5 10h14v10H5z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 13l4 4L19 7',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  bell: 'M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 21h4',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  edit: 'M12 20h9M16 4l4 4L8 20l-4 1 1-4z',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
};

export function Icon({ name, size = 16, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  const d = P[name];
  if (!d) {
    return <span className="wf-icon" aria-hidden style={{ display: 'inline-block', width: size, height: size, border: '1px solid var(--wf-line)', borderRadius: 3, ...style }} />;
  }
  return (
    <svg className="wf-icon" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden style={style}>
      <path d={d} />
    </svg>
  );
}
