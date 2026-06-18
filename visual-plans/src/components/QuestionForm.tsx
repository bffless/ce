import type { ReactNode } from 'react';

export type Question = string | { q: ReactNode; options?: string[]; recommend?: string };

/**
 * Open questions block — only ever at the BOTTOM of a document. Lists
 * decisions still needed before implementation, with optional options and a
 * recommended default.
 */
export function QuestionForm({ questions, title = 'Open questions' }: { questions: Question[]; title?: string }) {
  if (!questions.length) return null;
  return (
    <section className="wf-card" style={{ margin: '24px 0 0', background: 'var(--wf-card)' }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>{title}</div>
      <ol style={{ margin: 0, paddingInlineStart: 20, display: 'grid', gap: 12 }}>
        {questions.map((raw, i) => {
          const it = typeof raw === 'string' ? { q: raw } : raw;
          return (
            <li key={i} style={{ fontSize: 14 }}>
              <div style={{ fontWeight: 500 }}>{it.q}</div>
              {it.options?.length ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {it.options.map((o) => (
                    <span key={o} className="wf-pill" style={o === it.recommend ? { background: 'var(--wf-accent-soft)', color: 'var(--wf-accent)', borderColor: 'var(--wf-accent)' } : undefined}>
                      {o}{o === it.recommend ? ' ★' : ''}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
