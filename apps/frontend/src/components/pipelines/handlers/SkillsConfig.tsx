import {
  useListProjectSkillsQuery,
  useGetProjectSkillsPathQuery,
  useGetProjectSkillsAliasQuery,
  useGetProjectByIdQuery,
} from '@/services/projectsApi';
import { useListAliasesQuery } from '@/services/repoApi';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Info } from 'lucide-react';

export interface SkillsConfigValue {
  mode: 'none' | 'all' | 'selected';
  enabled?: string[];
  /** Directory in the deployment holding SKILL.md files. Inherits the
   *  project-wide default when empty. */
  path?: string;
  /** Deployment alias to load skills from. Inherits the project-wide default,
   *  then the deployment serving the request, when empty. */
  alias?: string;
}

interface SkillsConfigProps {
  config: SkillsConfigValue;
  onChange: (config: SkillsConfigValue) => void;
  projectId: string;
}

const AUTO = '__auto__';

export function SkillsConfig({ config, onChange, projectId }: SkillsConfigProps) {
  // Both source controls live on the step and save with the rule. The project
  // settings below are read-only here — they only supply the inherited default
  // shown when a step leaves a field blank.
  const { data: projectPathData } = useGetProjectSkillsPathQuery({ projectId });
  const { data: projectAliasData } = useGetProjectSkillsAliasQuery({ projectId });
  const projectPath = projectPathData?.skillsPath || '.bffless/skills';
  const projectAlias = projectAliasData?.skillsAlias || null;

  const { data, isLoading } = useListProjectSkillsQuery({
    projectId,
    path: config.path?.trim() || undefined,
    alias: config.alias?.trim() || undefined,
  });
  const skills = data?.skills ?? [];

  const { data: project } = useGetProjectByIdQuery(projectId);
  const { data: aliasesData } = useListAliasesQuery(
    { owner: project?.owner ?? '', repo: project?.name ?? '' },
    { skip: !project?.owner || !project?.name },
  );
  const aliases = aliasesData?.aliases ?? [];

  const effectivePath = config.path?.trim() || projectPath;
  const noSkillsFound = config.mode === 'selected' && !isLoading && skills.length === 0;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Skills Mode</Label>
        <Select
          value={config.mode}
          onValueChange={(v) =>
            onChange({ ...config, mode: v as SkillsConfigValue['mode'] })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Disabled</SelectItem>
            <SelectItem value="all">Enable All Skills</SelectItem>
            <SelectItem value="selected">Select Skills</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {config.mode === 'none' && 'Skills are disabled for this handler.'}
          {config.mode === 'all' && 'All available skills will be enabled.'}
          {config.mode === 'selected' && 'Choose specific skills to enable.'}
        </p>
      </div>

      {config.mode !== 'none' && (
        <div className="space-y-2">
          <Label>Skills Source (Alias)</Label>
          <Select
            value={config.alias || AUTO}
            onValueChange={(v) =>
              onChange({ ...config, alias: v === AUTO ? undefined : v })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>
                {projectAlias
                  ? `Inherit project default (${projectAlias})`
                  : 'Auto (serving deployment)'}
              </SelectItem>
              {aliases.map((a) => (
                <SelectItem key={a.name} value={a.name}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Which deployment alias this step loads{' '}
            <code className="bg-muted px-1 rounded">SKILL.md</code> files from. Saved with the
            rule, so each AI step can use its own.
          </p>
        </div>
      )}

      {config.mode !== 'none' && (
        <div className="space-y-2">
          <Label>Skills Path</Label>
          <Input
            value={config.path ?? ''}
            onChange={(e) => onChange({ ...config, path: e.target.value || undefined })}
            placeholder={projectPath}
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Path within the deployment where{' '}
            <code className="bg-muted px-1 rounded">SKILL.md</code> files live. Leave blank to
            inherit the project default (
            <code className="bg-muted px-1 rounded">{projectPath}</code>). An app served under a
            base path publishes skills to a non-hidden directory — e.g.{' '}
            <code className="bg-muted px-1 rounded">apps/studio/dist/bffless/skills</code>.
          </p>
        </div>
      )}

      {config.mode === 'selected' && (
        <div className="space-y-2">
          <Label>Enabled Skills</Label>
          {isLoading ? (
            <Skeleton className="h-20" />
          ) : noSkillsFound ? (
            // Loud on purpose: an unresolvable path used to fail silently at
            // runtime, with the model inventing a skill it never loaded.
            <Alert variant="destructive">
              <Info className="h-4 w-4" />
              <AlertDescription>
                No <code className="bg-muted px-1 rounded">SKILL.md</code> files found under{' '}
                <code className="bg-muted px-1 rounded">{effectivePath}</code>
                {config.alias ? ` on alias "${config.alias}"` : ''}. This step will run with no
                skills loaded — check the path against your deployment's files.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto rounded-md border p-3">
              {skills.map((skill) => (
                <div key={skill.name} className="flex items-start gap-3">
                  <Checkbox
                    id={`skill-${skill.name}`}
                    checked={config.enabled?.includes(skill.name) ?? false}
                    onCheckedChange={(checked) => {
                      const current = config.enabled ?? [];
                      onChange({
                        ...config,
                        enabled: checked
                          ? [...current, skill.name]
                          : current.filter((n) => n !== skill.name),
                      });
                    }}
                  />
                  <div className="flex-1 leading-none">
                    <label
                      htmlFor={`skill-${skill.name}`}
                      className="font-medium text-sm cursor-pointer"
                    >
                      {skill.name}
                    </label>
                    <p className="text-xs text-muted-foreground mt-1">
                      {skill.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {config.mode !== 'none' && (
        <Alert className="border-blue-500/30 bg-blue-500/5">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-xs">
            When skills are enabled, the AI can use the <code className="bg-muted px-1 rounded">load_skill</code> tool
            to retrieve detailed instructions for specific tasks.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
