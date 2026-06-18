import type { ReactNode } from 'react';
import { Icon } from './Icon';

export type FlowNode = { id: string; label: ReactNode; sub?: ReactNode };

/**
 * Lightweight architecture / data-flow diagram rendered as a token-styled
 * node chain (no SVG layout engine). For freeform diagrams, pass children
 * instead and lay them out with flex/grid.
 */
export function Diagram({
  nodes, direction = 'row', caption, children,
}: {
  nodes?: FlowNode[];
  direction?: 'row' | 'col';
  caption?: string;
  children?: ReactNode;
}) {
  const isRow = direction === 'row';
  return (
    <figure className="wf-card" style={{ margin: '14px 0' }}>
      {caption && <figcaption className="wf-eyebrow" style={{ marginBottom: 10 }}>{caption}</figcaption>}
      {nodes ? (
        <div style={{ display: 'flex', flexDirection: isRow ? 'row' : 'column', alignItems: 'stretch', gap: 0, flexWrap: 'wrap' }}>
          {nodes.map((n, i) => (
            <div key={n.id} style={{ display: 'flex', flexDirection: isRow ? 'row' : 'column', alignItems: 'center', gap: 0, flex: isRow ? '1 1 0' : undefined, minWidth: 0 }}>
              <div className="wf-box" style={{ flex: 1, minWidth: 0, textAlign: 'center', padding: '10px 12px' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{n.label}</div>
                {n.sub && <div className="wf-muted" style={{ fontSize: 12, marginTop: 2 }}>{n.sub}</div>}
              </div>
              {i < nodes.length - 1 && (
                <span aria-hidden style={{ color: 'var(--wf-muted)', padding: isRow ? '0 6px' : '4px 0', transform: isRow ? undefined : 'rotate(90deg)' }}>
                  <Icon name="arrowRight" />
                </span>
              )}
            </div>
          ))}
        </div>
      ) : children}
    </figure>
  );
}
