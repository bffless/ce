import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SiblingRulePicker } from './SiblingRulePicker';
import { StringListInput } from './StringListInput';
import {
  emptyStaticResource,
  emptyTemplate,
  templateVariables,
  type McpResourceTemplate,
  type McpResources,
  type McpStaticResource,
  type Problem,
} from './model';

const MIME_SUGGESTIONS = [
  'text/html;profile=mcp-app',
  'text/html',
  'application/json',
  'text/plain',
  'text/markdown',
  'image/png',
];

const CSP_TOKENS = [
  { value: '$app', hint: "this deployment's origin" },
  { value: '$storage', hint: "the storage backend's origin" },
];

interface McpResourcesSectionProps {
  resources: McpResources;
  onChange: (resources: McpResources) => void;
  problems: Problem[];
  ruleSetId?: string;
  excludeRuleId?: string;
}

/**
 * `resources`: static `ui://` resources, URI templates, the optional list
 * rule and the CSP every resource is stamped with.
 */
export function McpResourcesSection({
  resources,
  onChange,
  problems,
  ruleSetId,
  excludeRuleId,
}: McpResourcesSectionProps) {
  const id = useId();
  const patch = (p: Partial<McpResources>) => onChange({ ...resources, ...p });

  const replaceStatic = (i: number, r: McpStaticResource) =>
    patch({ static: resources.static.map((x, j) => (j === i ? r : x)) });
  const replaceTemplate = (i: number, t: McpResourceTemplate) =>
    patch({ templates: resources.templates.map((x, j) => (j === i ? t : x)) });

  const problemAt = (kind: 'static' | 'templates', i: number) =>
    problems.find((p) => p.path[0] === 'resources' && p.path[1] === kind && p.path[2] === i)
      ?.message;
  const listProblem = problems.find(
    (p) => p.path[0] === 'resources' && p.path[1] === 'list',
  )?.message;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label>Static resources</Label>
            <p className="text-xs text-muted-foreground">
              Fixed <code>ui://</code> URIs a host can read — an MCP App&apos;s HTML, for one.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => patch({ static: [...resources.static, emptyStaticResource()] })}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add static resource
          </Button>
        </div>
        {resources.static.map((r, i) => (
          <ResourceCard
            key={i}
            testId={`mcp-static-${i}`}
            title={r.name || r.uri || `resource ${i + 1}`}
            error={problemAt('static', i)}
            onRemove={() => patch({ static: resources.static.filter((_, j) => j !== i) })}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="URI" id={`${id}-s${i}-uri`}>
                <Input
                  id={`${id}-s${i}-uri`}
                  value={r.uri}
                  placeholder="ui://my-app/view.html"
                  onChange={(e) => replaceStatic(i, { ...r, uri: e.target.value })}
                  className="font-mono text-sm"
                />
              </Field>
              <Field label="Name" id={`${id}-s${i}-name`}>
                <Input
                  id={`${id}-s${i}-name`}
                  value={r.name}
                  placeholder="Human-readable name"
                  onChange={(e) => replaceStatic(i, { ...r, name: e.target.value })}
                />
              </Field>
            </div>
            <SiblingRulePicker
              label="Answered by rule"
              value={r.rule.path}
              method="GET"
              ruleSetId={ruleSetId}
              excludeRuleId={excludeRuleId}
              onChange={(path) => replaceStatic(i, { ...r, rule: { ...r.rule, path } })}
              help="Read with GET; its body becomes the resource's content."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Description" id={`${id}-s${i}-desc`}>
                <Input
                  id={`${id}-s${i}-desc`}
                  value={r.description ?? ''}
                  onChange={(e) =>
                    replaceStatic(i, { ...r, description: e.target.value || undefined })
                  }
                />
              </Field>
              <MimeField
                id={`${id}-s${i}-mime`}
                value={r.mimeType ?? ''}
                onChange={(v) => replaceStatic(i, { ...r, mimeType: v || undefined })}
              />
            </div>
          </ResourceCard>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label>Resource templates</Label>
            <p className="text-xs text-muted-foreground">
              A URI pattern with <code>{'{var}'}</code> (one segment) or <code>{'{var+}'}</code> (a
              tail) that maps onto a sibling path with the same variables.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => patch({ templates: [...resources.templates, emptyTemplate()] })}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add template
          </Button>
        </div>
        {resources.templates.map((t, i) => {
          const declared = templateVariables(t.uriTemplate);
          const undeclared = templateVariables(t.rule.path).filter((v) => !declared.includes(v));
          return (
            <ResourceCard
              key={i}
              testId={`mcp-template-${i}`}
              title={t.name || t.uriTemplate || `template ${i + 1}`}
              error={problemAt('templates', i)}
              onRemove={() => patch({ templates: resources.templates.filter((_, j) => j !== i) })}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="URI template" id={`${id}-t${i}-uri`}>
                  <Input
                    id={`${id}-t${i}-uri`}
                    value={t.uriTemplate}
                    placeholder="ui://my-app/{impl}/{path+}"
                    onChange={(e) => replaceTemplate(i, { ...t, uriTemplate: e.target.value })}
                    className="font-mono text-sm"
                  />
                  {declared.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Variables: {declared.join(', ')}
                    </p>
                  )}
                </Field>
                <Field label="Name" id={`${id}-t${i}-name`}>
                  <Input
                    id={`${id}-t${i}-name`}
                    value={t.name}
                    onChange={(e) => replaceTemplate(i, { ...t, name: e.target.value })}
                  />
                </Field>
              </div>
              <SiblingRulePicker
                label="Answered by rule"
                value={t.rule.path}
                method="GET"
                template
                ruleSetId={ruleSetId}
                excludeRuleId={excludeRuleId}
                placeholder="/w/{impl}/{path+}"
                onChange={(path) => replaceTemplate(i, { ...t, rule: { ...t.rule, path } })}
                help="The same variables, expanded into the sibling's path."
              />
              {undeclared.length > 0 && (
                <p className="text-xs text-destructive">
                  {undeclared.join(', ')} used in the rule path but not declared by the template.
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Description" id={`${id}-t${i}-desc`}>
                  <Input
                    id={`${id}-t${i}-desc`}
                    value={t.description ?? ''}
                    onChange={(e) =>
                      replaceTemplate(i, { ...t, description: e.target.value || undefined })
                    }
                  />
                </Field>
                <MimeField
                  id={`${id}-t${i}-mime`}
                  value={t.mimeType ?? ''}
                  onChange={(v) => replaceTemplate(i, { ...t, mimeType: v || undefined })}
                />
              </div>
            </ResourceCard>
          );
        })}
      </div>

      <div className="space-y-3">
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={resources.list !== undefined}
            aria-label="Enumerate resources from a sibling rule"
            onCheckedChange={(c) =>
              patch({ list: c === true ? { rule: { path: '', method: 'GET' } } : undefined })
            }
          />
          <span>
            <span className="block font-medium">Enumerate resources from a sibling rule</span>
            <span className="block text-xs text-muted-foreground">
              For resources that vary at run time: a GET rule whose JSON answer is the list (an
              array, or <code>{'{ resources }'}</code>), merged into <code>resources/list</code>.
            </span>
          </span>
        </label>
        {resources.list && (
          <div className="pl-6">
            <SiblingRulePicker
              label="List rule"
              value={resources.list.rule.path}
              method="GET"
              ruleSetId={ruleSetId}
              excludeRuleId={excludeRuleId}
              onChange={(path) => patch({ list: { rule: { ...resources.list!.rule, path } } })}
            />
            {listProblem && <p className="text-xs text-destructive">{listProblem}</p>}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <Label>Content security policy</Label>
          <p className="text-xs text-muted-foreground">
            Origins a host lets every resource reach (<code>_meta.ui.csp</code>). <code>$app</code>{' '}
            and <code>$storage</code> resolve per request.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <StringListInput
            label="Connect domains"
            value={resources.csp.connectDomains}
            onChange={(connectDomains) => patch({ csp: { ...resources.csp, connectDomains } })}
            suggestions={CSP_TOKENS}
            placeholder="https://api.example.com"
            help="fetch / XHR / WebSocket targets."
          />
          <StringListInput
            label="Resource domains"
            value={resources.csp.resourceDomains}
            onChange={(resourceDomains) => patch({ csp: { ...resources.csp, resourceDomains } })}
            suggestions={CSP_TOKENS}
            placeholder="https://cdn.example.com"
            help="Images, media, scripts and styles."
          />
        </div>
      </div>
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function MimeField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label="MIME type" id={id}>
      <Input
        id={id}
        list={`${id}-options`}
        value={value}
        placeholder="text/html;profile=mcp-app"
        onChange={(e) => onChange(e.target.value)}
        className="font-mono text-sm"
      />
      <datalist id={`${id}-options`}>
        {MIME_SUGGESTIONS.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </Field>
  );
}

function ResourceCard({
  testId,
  title,
  error,
  onRemove,
  children,
}: {
  testId: string;
  title: string;
  error?: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div data-testid={testId} className="rounded-md border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-sm">{title}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label={`Remove ${title}`}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
