export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const METHOD_FG: Record<Method, string> = {
  GET: 'var(--wf-ok)', POST: 'var(--wf-accent)', PUT: 'var(--wf-warn)',
  PATCH: 'var(--wf-warn)', DELETE: 'var(--wf-del)',
};

/**
 * HTTP endpoint contract: method + path, optional summary, and request /
 * response example bodies. `change` flags a new or modified endpoint.
 */
export function ApiEndpoint({
  method, path, summary, request, response, change,
}: {
  method: Method;
  path: string;
  summary?: string;
  request?: string;
  response?: string;
  change?: 'added' | 'changed';
}) {
  return (
    <figure className="wf-card" style={{ margin: '14px 0', padding: 0, overflow: 'hidden' }}>
      <figcaption style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '1px solid var(--wf-line)', background: 'var(--wf-paper)', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--wf-mono)', fontWeight: 700, fontSize: 12, color: METHOD_FG[method] }}>{method}</span>
        <span style={{ fontFamily: 'var(--wf-mono)', fontSize: 14 }}>{path}</span>
        {change && <span className="wf-pill" style={{ fontSize: 11 }}>{change}</span>}
        {summary && <span className="wf-muted" style={{ fontSize: 13 }}>{summary}</span>}
      </figcaption>
      <div style={{ display: 'grid', gridTemplateColumns: request && response ? '1fr 1fr' : '1fr', gap: 1, background: 'var(--wf-line)' }}>
        {request && <Body label="Request" code={request} />}
        {response && <Body label="Response" code={response} />}
      </div>
    </figure>
  );
}

function Body({ label, code }: { label: string; code: string }) {
  return (
    <div style={{ background: 'var(--wf-card)', padding: '10px 14px' }}>
      <div className="wf-eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      <pre style={{ margin: 0, fontFamily: 'var(--wf-mono)', fontSize: 12.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{code}</pre>
    </div>
  );
}
