export type Change = 'added' | 'removed' | 'changed';
export type FileNode = { path: string; change?: Change; add?: number; del?: number; note?: string };

const MARK: Record<Change, { sign: string; cls: string }> = {
  added: { sign: 'A', cls: 'flag-added' },
  removed: { sign: 'D', cls: 'flag-removed' },
  changed: { sign: 'M', cls: 'flag-changed' },
};

/**
 * Flat list of touched files with change flags and +/- line stats. Indent a
 * path with leading spaces or slashes; it renders monospace as-is.
 */
export function FileTree({ files, title = 'Files' }: { files: FileNode[]; title?: string }) {
  const tot = files.reduce((a, f) => ({ add: a.add + (f.add ?? 0), del: a.del + (f.del ?? 0) }), { add: 0, del: 0 });
  return (
    <figure className="wf-card" style={{ margin: '14px 0', padding: 0, overflow: 'hidden' }}>
      <figcaption style={{ display: 'flex', alignItems: 'center', padding: '9px 14px', borderBottom: '1px solid var(--wf-line)', background: 'var(--wf-paper)' }}>
        <span className="wf-eyebrow">{title}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--wf-mono)', fontSize: 12 }}>
          <span className="flag-added">+{tot.add}</span>{' '}
          <span className="flag-removed">−{tot.del}</span>
        </span>
      </figcaption>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontFamily: 'var(--wf-mono)', fontSize: 13 }}>
        {files.map((f, i) => {
          const m = f.change ? MARK[f.change] : null;
          return (
            <li key={f.path} className={f.change ? `bg-${f.change}` : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', borderTop: i ? '1px solid var(--wf-line)' : undefined, whiteSpace: 'pre' }}>
              <span className={m?.cls} style={{ width: 12, textAlign: 'center', fontWeight: 700 }}>{m?.sign ?? ''}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.path}</span>
              {f.note && <span className="wf-muted" style={{ fontFamily: 'var(--wf-sans)', fontSize: 12 }}>{f.note}</span>}
              {(f.add != null || f.del != null) && (
                <span style={{ fontSize: 12 }}>
                  {f.add ? <span className="flag-added">+{f.add} </span> : null}
                  {f.del ? <span className="flag-removed">−{f.del}</span> : null}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
