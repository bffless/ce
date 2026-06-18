import type { ReactNode } from 'react';

export type Column = { title: ReactNode; tone?: 'neutral' | 'before' | 'after'; children?: ReactNode; body?: ReactNode };

const TONE = {
  neutral: { bd: 'var(--wf-line)', fg: 'var(--wf-ink)' },
  before: { bd: 'var(--wf-del)', fg: 'var(--wf-del)' },
  after: { bd: 'var(--wf-ok)', fg: 'var(--wf-ok)' },
};

/**
 * Side-by-side comparison (before/after, option A/B). Provide column content
 * via `body` prop (data use) or as a single child per column.
 */
export function Columns({ columns, children }: { columns?: Column[]; children?: ReactNode }) {
  const cols = columns ?? [];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(cols.length, 1)}, minmax(0, 1fr))`, gap: 12, margin: '14px 0' }}>
      {cols.length
        ? cols.map((c, i) => {
            const t = TONE[c.tone ?? 'neutral'];
            return (
              <div key={i} className="wf-card" style={{ borderTopWidth: 2, borderTopColor: t.bd }}>
                <div className="wf-eyebrow" style={{ color: t.fg, marginBottom: 8 }}>{c.title}</div>
                <div style={{ fontSize: 14 }}>{c.body ?? c.children}</div>
              </div>
            );
          })
        : children}
    </div>
  );
}
