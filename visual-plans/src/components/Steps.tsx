import type { ReactNode } from 'react';

export type Step = string | { title: ReactNode; detail?: ReactNode; files?: string[] };

/**
 * Ordered implementation steps. Pass plain strings for simple lists, or
 * objects with `title` / `detail` / `files` to name the real files touched.
 */
export function Steps({ items }: { items: Step[] }) {
  return (
    <ol style={{ listStyle: 'none', counterReset: 'step', margin: '14px 0', padding: 0 }}>
      {items.map((raw, i) => {
        const item = typeof raw === 'string' ? { title: raw } : raw;
        return (
          <li key={i} style={{ counterIncrement: 'step', display: 'flex', gap: 12, padding: '10px 0', borderTop: i ? '1px solid var(--wf-line)' : undefined }}>
            <span aria-hidden style={{
              flex: 'none', width: 24, height: 24, borderRadius: 999, fontSize: 12, fontWeight: 600,
              display: 'grid', placeItems: 'center', background: 'var(--wf-accent-soft)', color: 'var(--wf-accent)',
            }}>{i + 1}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 500 }}>{item.title}</div>
              {item.detail && <div style={{ fontSize: 14, color: 'var(--wf-muted)', marginTop: 2 }}>{item.detail}</div>}
              {item.files?.length ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {item.files.map((f) => <span key={f} className="wf-chip">{f}</span>)}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
