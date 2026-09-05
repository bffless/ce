import { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Copy, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { McpToolForm } from './McpToolForm';
import { emptyTool, isRecord, type McpTool, type Problem } from './model';

interface McpToolListProps {
  tools: McpTool[];
  onChange: (tools: McpTool[]) => void;
  staticResourceUris: string[];
  problems: Problem[];
  ruleSetId?: string;
  excludeRuleId?: string;
}

const hasContent = (t: McpTool) =>
  t.description !== '' ||
  (isRecord(t.inputSchema.properties) && Object.keys(t.inputSchema.properties).length > 0);

const hasUi = (t: McpTool) => isRecord(t._meta.ui) && typeof t._meta.ui.resourceUri === 'string';

export function McpToolList({
  tools,
  onChange,
  staticResourceUris,
  problems,
  ruleSetId,
  excludeRuleId,
}: McpToolListProps) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const setExpandedAt = (i: number, on: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (on) next.add(i);
      else next.delete(i);
      return next;
    });

  const replaceAt = (i: number, tool: McpTool) =>
    onChange(tools.map((t, j) => (j === i ? tool : t)));

  const remove = (i: number) => {
    onChange(tools.filter((_, j) => j !== i));
    setExpanded(
      (prev) => new Set([...prev].filter((j) => j !== i).map((j) => (j > i ? j - 1 : j))),
    );
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= tools.length) return;
    const next = [...tools];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    setExpanded((prev) => {
      const s = new Set<number>();
      prev.forEach((k) => s.add(k === i ? j : k === j ? i : k));
      return s;
    });
  };

  const add = () => {
    onChange([...tools, emptyTool()]);
    setExpandedAt(tools.length, true);
  };

  const duplicate = (i: number) => {
    const copy: McpTool = { ...tools[i], name: `${tools[i].name}-copy` };
    onChange([...tools.slice(0, i + 1), copy, ...tools.slice(i + 1)]);
    setExpandedAt(i + 1, true);
  };

  const problemsFor = (i: number) =>
    problems.filter((p) => p.path[0] === 'tools' && p.path[1] === i);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label>Tools</Label>
          <p className="text-xs text-muted-foreground">
            What <code>tools/list</code> advertises, in this order. Each one runs a sibling rule.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="h-3 w-3 mr-1" />
          Add tool
        </Button>
      </div>

      {tools.length === 0 && (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          No tools yet. A server with no tools still answers <code>initialize</code>.
        </p>
      )}

      {tools.map((tool, i) => {
        const isOpen = expanded.has(i);
        const label = tool.name || `tool ${i + 1}`;
        const toolProblems = problemsFor(i);
        const nameProblem = toolProblems.find((p) => p.path[2] === 'name')?.message;
        return (
          <Card key={i} data-testid={`mcp-tool-${i}`}>
            <CardHeader className="py-2 px-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${label}`}
                  aria-expanded={isOpen}
                  onClick={() => setExpandedAt(i, !isOpen)}
                  className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-left hover:text-primary"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0" />
                  )}
                  <span className="font-mono text-sm font-medium">
                    {tool.name || <span className="italic text-muted-foreground">unnamed</span>}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground truncate">
                    {tool.rule.method ?? 'POST'} {tool.rule.path || '—'}
                  </span>
                  <span className="flex gap-1">
                    {tool.annotations.readOnlyHint === true && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal">
                        read-only
                      </Badge>
                    )}
                    {tool.annotations.destructiveHint === true && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal">
                        destructive
                      </Badge>
                    )}
                    {tool.visibility.includes('app') && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0 font-normal">
                        app-only
                      </Badge>
                    )}
                    {hasUi(tool) && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0 font-normal">
                        UI
                      </Badge>
                    )}
                  </span>
                  {toolProblems.length > 0 && (
                    <span
                      role="img"
                      aria-label={`${toolProblems.length} problem${toolProblems.length === 1 ? '' : 's'}`}
                      title={toolProblems.map((p) => p.message).join('\n')}
                      className="h-2 w-2 rounded-full bg-destructive"
                    />
                  )}
                </button>
                <div className="flex gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={i === 0}
                    aria-label={`Move ${label} up`}
                    onClick={() => move(i, -1)}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={i === tools.length - 1}
                    aria-label={`Move ${label} down`}
                    onClick={() => move(i, 1)}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Duplicate ${label}`}
                    onClick={() => duplicate(i)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Delete ${label}`}
                    onClick={() => (hasContent(tool) ? setConfirmDelete(i) : remove(i))}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            {isOpen && (
              <CardContent className="pt-0 pb-4 px-3 sm:px-4">
                <McpToolForm
                  tool={tool}
                  onChange={(t) => replaceAt(i, t)}
                  staticResourceUris={staticResourceUris}
                  ruleSetId={ruleSetId}
                  excludeRuleId={excludeRuleId}
                  nameError={nameProblem}
                />
              </CardContent>
            )}
          </Card>
        );
      })}

      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {confirmDelete !== null ? tools[confirmDelete]?.name || 'this tool' : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Clients stop seeing the tool once the rule is saved. The sibling rule it pointed at is
              not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDelete !== null) remove(confirmDelete);
                setConfirmDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
