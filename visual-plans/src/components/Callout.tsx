import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type CalloutKind = 'decision' | 'warn' | 'ok' | 'note';

const KIND: Record<CalloutKind, { fg: string; bg: string; icon: IconName; label: string }> = {
  decision: { fg: 'var(--wf-accent)', bg: 'var(--wf-accent-soft)', icon: 'check', label: 'Decision' },
  warn: { fg: 'var(--wf-warn)', bg: 'var(--wf-warn-soft)', icon: 'bell', label: 'Risk' },
  ok: { fg: 'var(--wf-ok)', bg: 'var(--wf-ok-soft)', icon: 'check', label: 'Confirmed' },
  note: { fg: 'var(--wf-muted)', bg: 'var(--wf-card)', icon: 'more', label: 'Note' },
};

/**
 * Highlighted aside for decisions, risks, and notes. Use `decision` to make a
 * hard-to-reverse choice the headline; `warn` for risks.
 */
export function Callout({ kind = 'note', title, children }: { kind?: CalloutKind; title?: ReactNode; children: ReactNode }) {
  const k = KIND[kind];
  return (
    <div role="note" style={{
      display: 'flex', gap: 10, padding: '12px 14px', margin: '14px 0',
      borderRadius: 'var(--wf-radius)', background: k.bg,
      borderInlineStart: `3px solid ${k.fg}`,
    }}>
      <span style={{ color: k.fg, marginTop: 2 }}><Icon name={k.icon} /></span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: k.fg }}>{title ?? k.label}</div>
        <div style={{ fontSize: 14, marginTop: 2 }}>{children}</div>
      </div>
    </div>
  );
}
