import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ExpressionInput } from './ExpressionInput';
import type { PreviousStep } from './AvailableVariables';

interface GitHubApiConfigProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  previousSteps: PreviousStep[];
}

export function GitHubApiConfig({ config, onChange, previousSteps }: GitHubApiConfigProps) {
  const action = (config.action as string) || 'create_repo_from_template';

  const [clientPayloadPairs, setClientPayloadPairs] = useState<Array<{ key: string; value: string }>>(
    () => Object.entries((config.clientPayload as Record<string, string>) || {}).map(([key, value]) => ({ key, value: String(value) })),
  );

  useEffect(() => {
    if (action !== 'dispatch') return;
    const obj = clientPayloadPairs.reduce<Record<string, string>>((acc, { key, value }) => {
      if (key) acc[key] = value;
      return acc;
    }, {});
    if (JSON.stringify(obj) === JSON.stringify(config.clientPayload || {})) return;
    onChange({ ...config, clientPayload: Object.keys(obj).length > 0 ? obj : undefined });
  }, [clientPayloadPairs, action]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Action</Label>
        <Select
          value={action}
          onValueChange={(value) => onChange({ ...config, action: value })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="create_repo_from_template">Create Repo from Template</SelectItem>
            <SelectItem value="set_repo_variable">Set Repo Variable</SelectItem>
            <SelectItem value="create_issue">Create Issue</SelectItem>
            <SelectItem value="add_issue_comment">Add Issue Comment</SelectItem>
            <SelectItem value="close_issue">Close Issue</SelectItem>
            <SelectItem value="close_pull_request">Close Pull Request</SelectItem>
            <SelectItem value="merge_pull_request">Merge Pull Request</SelectItem>
            <SelectItem value="list_pull_requests">List Pull Requests</SelectItem>
            <SelectItem value="dispatch">Repository Dispatch</SelectItem>
            <SelectItem value="list_workflow_runs">List Workflow Runs</SelectItem>
            <SelectItem value="get_workflow_run">Get Workflow Run</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {action === 'set_repo_variable' && (
        <>
          <div className="space-y-2">
            <Label>Owner *</Label>
            <ExpressionInput
              value={(config.owner as string) || ''}
              onChange={(value) => onChange({ ...config, owner: value })}
              placeholder="bffless-sites"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Repository owner (org or user)
            </p>
          </div>

          <div className="space-y-2">
            <Label>Repo *</Label>
            <ExpressionInput
              value={(config.repo as string) || ''}
              onChange={(value) => onChange({ ...config, repo: value })}
              placeholder="steps.create_repo.name"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Repository name
            </p>
          </div>

          <div className="space-y-2">
            <Label>Variable Name *</Label>
            <ExpressionInput
              value={(config.variableName as string) || ''}
              onChange={(value) => onChange({ ...config, variableName: value })}
              placeholder="SITE_DOMAIN"
              previousSteps={previousSteps}
            />
          </div>

          <div className="space-y-2">
            <Label>Variable Value *</Label>
            <ExpressionInput
              value={(config.variableValue as string) || ''}
              onChange={(value) => onChange({ ...config, variableValue: value })}
              placeholder="steps.build_name.siteUrl"
              previousSteps={previousSteps}
            />
          </div>
        </>
      )}

      {action === 'create_issue' && (
        <>
          <div className="space-y-2">
            <Label>Owner *</Label>
            <ExpressionInput
              value={(config.owner as string) || ''}
              onChange={(value) => onChange({ ...config, owner: value })}
              placeholder="bffless-sites"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Repository owner (org or user)
            </p>
          </div>

          <div className="space-y-2">
            <Label>Repo *</Label>
            <ExpressionInput
              value={(config.repo as string) || ''}
              onChange={(value) => onChange({ ...config, repo: value })}
              placeholder="steps.validate.repoName"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Repository name
            </p>
          </div>

          <div className="space-y-2">
            <Label>Title *</Label>
            <ExpressionInput
              value={(config.title as string) || ''}
              onChange={(value) => onChange({ ...config, title: value })}
              placeholder="steps.validate.title"
              previousSteps={previousSteps}
            />
          </div>

          <div className="space-y-2">
            <Label>Body *</Label>
            <ExpressionInput
              value={(config.body as string) || ''}
              onChange={(value) => onChange({ ...config, body: value })}
              placeholder="steps.validate.body"
              previousSteps={previousSteps}
            />
          </div>

          <div className="space-y-2">
            <Label>Labels</Label>
            <ExpressionInput
              value={Array.isArray(config.labels) ? (config.labels as string[]).join(', ') : (config.labels as string) || ''}
              onChange={(value) => onChange({ ...config, labels: value.split(',').map((l: string) => l.trim()).filter(Boolean) })}
              placeholder="customization, enhancement"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated list of labels to apply
            </p>
          </div>
        </>
      )}

      {action === 'add_issue_comment' && (
        <>
          <div className="space-y-2">
            <Label>Owner *</Label>
            <ExpressionInput
              value={(config.owner as string) || ''}
              onChange={(value) => onChange({ ...config, owner: value })}
              placeholder="bffless-sites"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Repository owner (org or user)
            </p>
          </div>

          <div className="space-y-2">
            <Label>Repo *</Label>
            <ExpressionInput
              value={(config.repo as string) || ''}
              onChange={(value) => onChange({ ...config, repo: value })}
              placeholder="steps.validate.repoName"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Repository name
            </p>
          </div>

          <div className="space-y-2">
            <Label>Issue Number *</Label>
            <ExpressionInput
              value={(config.issueNumber as string) || ''}
              onChange={(value) => onChange({ ...config, issueNumber: value })}
              placeholder="steps.lookup.issue_number"
              previousSteps={previousSteps}
            />
          </div>

          <div className="space-y-2">
            <Label>Body *</Label>
            <ExpressionInput
              value={(config.body as string) || ''}
              onChange={(value) => onChange({ ...config, body: value })}
              placeholder="steps.build_comment.body"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Comment body (supports markdown)
            </p>
          </div>
        </>
      )}

      {(action === 'close_issue' || action === 'close_pull_request' || action === 'merge_pull_request') && (
        <>
          <div className="space-y-2">
            <Label>Owner *</Label>
            <ExpressionInput
              value={(config.owner as string) || ''}
              onChange={(value) => onChange({ ...config, owner: value })}
              placeholder="bffless-sites"
              previousSteps={previousSteps}
            />
          </div>
          <div className="space-y-2">
            <Label>Repo *</Label>
            <ExpressionInput
              value={(config.repo as string) || ''}
              onChange={(value) => onChange({ ...config, repo: value })}
              placeholder="steps.validate.repoName"
              previousSteps={previousSteps}
            />
          </div>
          <div className="space-y-2">
            <Label>{action === 'close_issue' ? 'Issue Number *' : 'PR Number *'}</Label>
            <ExpressionInput
              value={(config.issueNumber as string) || ''}
              onChange={(value) => onChange({ ...config, issueNumber: value })}
              placeholder="steps.lookup.issue_number"
              previousSteps={previousSteps}
            />
          </div>
          {action === 'merge_pull_request' && (
            <div className="space-y-2">
              <Label>Merge Method</Label>
              <ExpressionInput
                value={(config.mergeMethod as string) || ''}
                onChange={(value) => onChange({ ...config, mergeMethod: value })}
                placeholder="merge, squash, or rebase (default: merge)"
                previousSteps={previousSteps}
              />
            </div>
          )}
        </>
      )}

      {action === 'list_pull_requests' && (
        <>
          <div className="space-y-2">
            <Label>Owner *</Label>
            <ExpressionInput
              value={(config.owner as string) || ''}
              onChange={(value) => onChange({ ...config, owner: value })}
              placeholder="bffless-sites"
              previousSteps={previousSteps}
            />
          </div>
          <div className="space-y-2">
            <Label>Repo *</Label>
            <ExpressionInput
              value={(config.repo as string) || ''}
              onChange={(value) => onChange({ ...config, repo: value })}
              placeholder="steps.validate.repoName"
              previousSteps={previousSteps}
            />
          </div>
          <div className="space-y-2">
            <Label>State</Label>
            <ExpressionInput
              value={(config.state as string) || ''}
              onChange={(value) => onChange({ ...config, state: value })}
              placeholder="open, closed, or all (default: open)"
              previousSteps={previousSteps}
            />
          </div>
        </>
      )}

      {(action === 'list_workflow_runs' || action === 'get_workflow_run') && (
        <>
          <div className="space-y-2">
            <Label>Owner *</Label>
            <ExpressionInput
              value={(config.owner as string) || ''}
              onChange={(value) => onChange({ ...config, owner: value })}
              placeholder="bffless"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">Repository owner (org or user)</p>
          </div>
          <div className="space-y-2">
            <Label>Repo *</Label>
            <ExpressionInput
              value={(config.repo as string) || ''}
              onChange={(value) => onChange({ ...config, repo: value })}
              placeholder="studio-oneshot"
              previousSteps={previousSteps}
            />
          </div>
        </>
      )}

      {action === 'list_workflow_runs' && (
        <>
          <div className="space-y-2">
            <Label>Event</Label>
            <ExpressionInput
              value={(config.event as string) || ''}
              onChange={(value) => onChange({ ...config, event: value })}
              placeholder="repository_dispatch"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Optional. Only return runs triggered by this event.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <ExpressionInput
              value={(config.status as string) || ''}
              onChange={(value) => onChange({ ...config, status: value })}
              placeholder="in_progress"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Optional. GitHub status or conclusion, e.g. queued, in_progress, completed, success.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Per page</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={(config.perPage as number) ?? ''}
              onChange={(e) => onChange({ ...config, perPage: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="30"
            />
            <p className="text-xs text-muted-foreground">1-100. Newest runs first.</p>
          </div>
        </>
      )}

      {action === 'get_workflow_run' && (
        <div className="space-y-2">
          <Label>Run ID *</Label>
          <ExpressionInput
            value={(config.runId as string) || ''}
            onChange={(value) => onChange({ ...config, runId: value })}
            placeholder="steps.load_run.github_run_id"
            previousSteps={previousSteps}
          />
          <p className="text-xs text-muted-foreground">
            The GitHub run id, usually stored from an earlier list_workflow_runs match.
          </p>
        </div>
      )}

      {action === 'create_repo_from_template' && (
        <>
          <div className="space-y-2">
            <Label>Template Owner *</Label>
            <ExpressionInput
              value={(config.templateOwner as string) || ''}
              onChange={(value) => onChange({ ...config, templateOwner: value })}
              placeholder="bffless-templates"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              GitHub org or user that owns the template repository
            </p>
          </div>

          <div className="space-y-2">
            <Label>Template Repo *</Label>
            <ExpressionInput
              value={(config.templateRepo as string) || ''}
              onChange={(value) => onChange({ ...config, templateRepo: value })}
              placeholder="my-template"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Name of the template repository
            </p>
          </div>

          <div className="space-y-2">
            <Label>Target Organization *</Label>
            <ExpressionInput
              value={(config.targetOrg as string) || ''}
              onChange={(value) => onChange({ ...config, targetOrg: value })}
              placeholder="my-org"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              GitHub org where the new repo will be created
            </p>
          </div>

          <div className="space-y-2">
            <Label>Repo Name *</Label>
            <ExpressionInput
              value={(config.repoName as string) || ''}
              onChange={(value) => onChange({ ...config, repoName: value })}
              placeholder="steps.validate.repoName"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Name for the new repository
            </p>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <ExpressionInput
              value={(config.description as string) || ''}
              onChange={(value) => onChange({ ...config, description: value })}
              placeholder="steps.validate.description"
              previousSteps={previousSteps}
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={config.private !== false}
              onCheckedChange={(checked) => onChange({ ...config, private: checked })}
            />
            <Label>Private repository</Label>
          </div>
        </>
      )}

      {action === 'dispatch' && (
        <>
          <div className="space-y-2">
            <Label>Owner *</Label>
            <ExpressionInput
              value={(config.owner as string) || ''}
              onChange={(value) => onChange({ ...config, owner: value })}
              placeholder="bffless-sites"
              previousSteps={previousSteps}
            />
          </div>

          <div className="space-y-2">
            <Label>Repo *</Label>
            <ExpressionInput
              value={(config.repo as string) || ''}
              onChange={(value) => onChange({ ...config, repo: value })}
              placeholder="steps.guard.repoName"
              previousSteps={previousSteps}
            />
          </div>

          <div className="space-y-2">
            <Label>Event Type *</Label>
            <ExpressionInput
              value={(config.eventType as string) || ''}
              onChange={(value) => onChange({ ...config, eventType: value })}
              placeholder="'compose'"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Workflows trigger via <code>on: repository_dispatch: types: [&lt;eventType&gt;]</code>. Quote string literals.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Client Payload (optional)</Label>
            <p className="text-xs text-muted-foreground">
              Key-value pairs delivered to the workflow as <code>{'${{ github.event.client_payload.<key> }}'}</code>. Values are evaluated as expressions.
            </p>
            <div className="space-y-2">
              {clientPayloadPairs.map((entry, i) => (
                <div key={i} className="space-y-2 rounded-md border border-border/50 p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Key</Label>
                      <ExpressionInput
                        value={entry.key}
                        onChange={(v) => {
                          const updated = [...clientPayloadPairs];
                          updated[i] = { ...updated[i], key: v };
                          setClientPayloadPairs(updated);
                        }}
                        placeholder="customizationId"
                        previousSteps={[]}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Value</Label>
                      <ExpressionInput
                        value={entry.value}
                        onChange={(v) => {
                          const updated = [...clientPayloadPairs];
                          updated[i] = { ...updated[i], value: v };
                          setClientPayloadPairs(updated);
                        }}
                        placeholder="steps.guard.customizationId"
                        previousSteps={previousSteps}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setClientPayloadPairs(clientPayloadPairs.filter((_, j) => j !== i))}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setClientPayloadPairs([...clientPayloadPairs, { key: '', value: '' }])}
                className="text-xs text-primary hover:underline"
              >
                + Add payload entry
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
