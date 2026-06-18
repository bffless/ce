import type { ReactNode } from 'react';
import { Icon } from './Icon';

export type CheckItem = string | { label: ReactNode; done?: boolean };

/** Scannable verification / acceptance checklist. */
export function Checklist({ items }: { items: CheckItem[] }) {
  return (
    <ul style={{ listStyle: 'none', margin: '14px 0', padding: 0 }}>
      {items.map((raw, i) => {
        const it = typeof raw === 'string' ? { label: raw, done: false } : raw;
        return (
          <li key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '5px 0', fontSize: 14 }}>
            <span style={{
              flex: 'none', width: 18, height: 18, borderRadius: 'var(--wf-radius)', display: 'grid', placeItems: 'center',
              border: `1px solid ${it.done ? 'var(--wf-ok)' : 'var(--wf-line)'}`,
              background: it.done ? 'var(--wf-ok-soft)' : 'transparent', color: 'var(--wf-ok)', marginTop: 1,
            }}>{it.done ? <Icon name="check" size={13} /> : null}</span>
            <span style={{ color: it.done ? 'var(--wf-muted)' : 'var(--wf-ink)', textDecoration: it.done ? 'line-through' : undefined }}>{it.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
