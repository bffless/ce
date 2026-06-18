import type { ReactNode } from 'react';

export type Surface = 'browser' | 'desktop' | 'mobile' | 'popover' | 'panel';

/**
 * Chrome frame for UI mockups. Compose the screen body from bare flex/grid
 * elements and the `.wf-*` helper classes + <Icon/> — never hard-code colors
 * or fonts inside. Use `mobile` only for genuinely phone-specific work.
 */
export function Wireframe({
  surface = 'browser', title, url, caption, children,
}: {
  surface?: Surface;
  title?: string;
  url?: string;
  caption?: string;
  children: ReactNode;
}) {
  const maxWidth = surface === 'mobile' ? 360 : surface === 'popover' ? 320 : undefined;
  return (
    <figure style={{ margin: '14px 0' }}>
      <div style={{
        maxWidth, margin: surface === 'mobile' ? '0 auto' : undefined,
        border: '1px solid var(--wf-line)', borderRadius: 'var(--wf-radius-lg)', overflow: 'hidden', background: 'var(--wf-paper)',
      }}>
        {surface === 'browser' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--wf-line)', background: 'var(--wf-card)' }}>
            <span style={{ display: 'flex', gap: 5 }}>
              {['#ef4444', '#f59e0b', '#22c55e'].map((c) => <span key={c} style={{ width: 9, height: 9, borderRadius: 999, background: 'var(--wf-line)' }} />)}
            </span>
            <span className="wf-chip" style={{ flex: 1, color: 'var(--wf-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url ?? 'app.example.com'}</span>
          </div>
        )}
        {(surface === 'desktop' || surface === 'panel') && title && (
          <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--wf-line)', background: 'var(--wf-card)', fontSize: 13, fontWeight: 600 }}>{title}</div>
        )}
        {surface === 'mobile' && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '6px', background: 'var(--wf-card)', borderBottom: '1px solid var(--wf-line)' }}>
            <span style={{ width: 50, height: 5, borderRadius: 999, background: 'var(--wf-line)' }} />
          </div>
        )}
        <div style={{ padding: 16, minHeight: 80, height: '100%' }}>{children}</div>
      </div>
      {caption && <figcaption className="wf-muted" style={{ fontSize: 12.5, marginTop: 6, textAlign: 'center' }}>{caption}</figcaption>}
    </figure>
  );
}
