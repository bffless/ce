export type DiffLine = string; // prefix with ' ', '+', or '-'

/**
 * Unified diff hunk with a required one-line summary. Lines are prefixed with
 * '+', '-', or ' ' (context). Long hunks collapse via native <details> (zero JS).
 */
export function Diff({
  file, summary, lines, collapsed = false, note,
}: {
  file: string;
  summary: string;
  lines: DiffLine[];
  collapsed?: boolean;
  note?: string;
}) {
  const body = (
    <pre style={{ margin: 0, overflow: 'auto', fontFamily: 'var(--wf-mono)', fontSize: 12.5, lineHeight: 1.5 }}>
      {lines.map((ln, i) => {
        const kind = ln[0] === '+' ? 'add' : ln[0] === '-' ? 'del' : 'ctx';
        const bg = kind === 'add' ? 'var(--wf-add-soft)' : kind === 'del' ? 'var(--wf-del-soft)' : 'transparent';
        const fg = kind === 'add' ? 'var(--wf-add)' : kind === 'del' ? 'var(--wf-del)' : 'var(--wf-ink)';
        return (
          <div key={i} style={{ background: bg, color: fg, padding: '0 14px', whiteSpace: 'pre' }}>{ln || ' '}</div>
        );
      })}
    </pre>
  );

  return (
    <figure className="wf-card" style={{ margin: '14px 0', padding: 0, overflow: 'hidden' }}>
      <details open={!collapsed}>
        <summary style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', cursor: 'pointer', listStyle: 'none', borderBottom: '1px solid var(--wf-line)', background: 'var(--wf-paper)' }}>
          <span style={{ fontFamily: 'var(--wf-mono)', fontSize: 13, fontWeight: 600 }}>{file}</span>
          <span className="wf-muted" style={{ fontSize: 13 }}>— {summary}</span>
        </summary>
        {body}
        {note && <div className="wf-muted" style={{ fontSize: 12.5, padding: '8px 14px', borderTop: '1px solid var(--wf-line)' }}>{note}</div>}
      </details>
    </figure>
  );
}
