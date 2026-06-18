export type Change = 'added' | 'removed' | 'changed' | undefined;

export type Field = {
  name: string;
  type: string;
  note?: string;
  change?: Change;
};

const MARK: Record<NonNullable<Change>, { sign: string; cls: string }> = {
  added: { sign: '+', cls: 'flag-added' },
  removed: { sign: '−', cls: 'flag-removed' },
  changed: { sign: '~', cls: 'flag-changed' },
};

/**
 * Database table / type shape with per-field change flags. Use for schema or
 * data-shape work; mark touched fields with `change` so reviewers see deltas.
 */
export function DataModel({ table, fields, caption }: { table: string; fields: Field[]; caption?: string }) {
  return (
    <figure className="wf-card" style={{ margin: '14px 0', padding: 0, overflow: 'hidden' }}>
      <figcaption style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderBottom: '1px solid var(--wf-line)', background: 'var(--wf-paper)' }}>
        <span className="wf-eyebrow">table</span>
        <span style={{ fontFamily: 'var(--wf-mono)', fontWeight: 600, fontSize: 14 }}>{table}</span>
        {caption && <span className="wf-muted" style={{ fontSize: 13 }}>· {caption}</span>}
      </figcaption>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
        <tbody>
          {fields.map((f, i) => {
            const m = f.change ? MARK[f.change] : null;
            return (
              <tr key={f.name} className={f.change ? `bg-${f.change}` : undefined} style={{ borderTop: i ? '1px solid var(--wf-line)' : undefined }}>
                <td style={{ width: 16, padding: '7px 0 7px 12px', textAlign: 'center' }} className={m?.cls}>{m?.sign}</td>
                <td style={{ padding: '7px 10px', fontFamily: 'var(--wf-mono)', fontWeight: 500 }}>{f.name}</td>
                <td style={{ padding: '7px 10px', fontFamily: 'var(--wf-mono)', color: 'var(--wf-muted)' }}>{f.type}</td>
                <td style={{ padding: '7px 12px 7px 10px', color: 'var(--wf-muted)' }}>{f.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </figure>
  );
}
