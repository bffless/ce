import type { ReactNode } from 'react';

export type Status = 'proposed' | 'approved' | 'done';

const STATUS_STYLE: Record<Status, { label: string; bg: string; fg: string; bd: string }> = {
  proposed: { label: 'Proposed', bg: 'var(--wf-accent-soft)', fg: 'var(--wf-accent)', bd: 'var(--wf-accent)' },
  approved: { label: 'Approved', bg: 'var(--wf-ok-soft)', fg: 'var(--wf-ok)', bd: 'var(--wf-ok)' },
  done: { label: 'Done', bg: 'var(--wf-card)', fg: 'var(--wf-muted)', bd: 'var(--wf-line)' },
};

/**
 * Document header — title, status badge, one-line objective, and meta row.
 * Put this first in every plan/recap.
 */
export function Meta({
  title, status = 'proposed', objective, date, tags = [], children,
}: {
  title: string;
  status?: Status;
  objective?: ReactNode;
  date?: string;
  tags?: string[];
  children?: ReactNode;
}) {
  const s = STATUS_STYLE[status];
  return (
    <header style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="wf-pill" style={{ background: s.bg, color: s.fg, borderColor: s.bd }}>{s.label}</span>
        {date && <span className="wf-muted" style={{ fontSize: 13 }}>{date}</span>}
        {tags.map((t) => <span key={t} className="wf-chip">{t}</span>)}
      </div>
      <h1 style={{ margin: '10px 0 6px', fontSize: 27, lineHeight: 1.18 }}>{title}</h1>
      {objective && <p style={{ margin: 0, fontSize: 16, color: 'var(--wf-muted)' }}>{objective}</p>}
      {children}
    </header>
  );
}
