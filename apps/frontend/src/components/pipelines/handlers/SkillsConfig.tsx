import { useState, useEffect } from 'react';
import {
  useListProjectSkillsQuery,
  useGetProjectSkillsPathQuery,
  useSetProjectSkillsPathMutation,
  useGetProjectByIdQuery,
  useGetProjectSkillsAliasQuery,
  useSetProjectSkillsAliasMutation,
} from '@/services/projectsApi';
import { useListAliasesQuery } from '@/services/repoApi';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
import { Info, Check } from 'lucide-react';

export interface SkillsConfigValue {
  mode: 'none' | 'all' | 'selected';
  enabled?: string[];
}

interface SkillsConfigProps {
  config: SkillsConfigValue;
  onChange: (config: SkillsConfigValue) => void;
  projectId: string;
}

export function SkillsConfig({ config, onChange, projectId }: SkillsConfigProps) {
  const { data, isLoading } = useListProjectSkillsQuery({ projectId });
  const { data: pathData } = useGetProjectSkillsPathQuery({ projectId });
  const [setSkillsPath, { isLoading: isSaving }] = useSetProjectSkillsPathMutation();
  const [localPath, setLocalPath] = useState('');
  const [saved, setSaved] = useState(false);
  const skills = data?.skills ?? [];

  // Skills alias: which deployment alias to load skills from
  const { data: project } = useGetProjectByIdQuery(projectId);
  const { data: aliasesData } = useListAliasesQuery(
    { owner: project?.owner ?? '', repo: project?.name ?? '' },
    { skip: !project?.owner || !project?.name },
  );
  const { data: aliasData } = useGetProjectSkillsAliasQuery({ projectId });
  const [setSkillsAlias] = useSetProjectSkillsAliasMutation();
  const aliases = aliasesData?.aliases ?? [];
  const AUTO = '__auto__';
  const selectedAlias = aliasData?.skillsAlias || AUTO;

  const handleAliasChange = async (value: string) => {
    await setSkillsAlias({
      projectId,
      skillsAlias: value === AUTO ? null : value,
    });
  };

  useEffect(() => {
    if (pathData?.skillsPath) {
      setLocalPath(pathData.skillsPath);
    }
  }, [pathData?.skillsPath]);

  const handleSavePath = async () => {
    if (!localPath.trim()) return;
    await setSkillsPath({ projectId, skillsPath: localPath.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const isDirty = pathData?.skillsPath !== localPath;

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
          <Select value={selectedAlias} onValueChange={handleAliasChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>Auto (serving deployment)</SelectItem>
              {aliases.map((a) => (
                <SelectItem key={a.name} value={a.name}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Which deployment alias to load <code className="bg-muted px-1 rounded">SKILL.md</code> files
            from. <strong>Auto</strong> uses whichever deployment serves the request at runtime; pick a
            specific alias to always load skills from there (e.g. a dedicated skills deployment).
          </p>
        </div>
      )}

      {config.mode !== 'none' && (
        <div className="space-y-2">
          <Label>Skills Path</Label>
          <div className="flex gap-2">
            <Input
              value={localPath}
              onChange={(e) => { setLocalPath(e.target.value); setSaved(false); }}
              placeholder=".bffless/skills"
              className="font-mono text-sm"
            />
            <Button
              size="sm"
              variant={saved ? 'default' : 'outline'}
              onClick={handleSavePath}
              disabled={!isDirty || isSaving}
            >
              {saved ? <Check className="h-4 w-4" /> : 'Save'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Path within the deployment where <code className="bg-muted px-1 rounded">SKILL.md</code> files
            are located. Useful for monorepos where skills aren't at the root.
          </p>
        </div>
      )}

      {config.mode === 'selected' && (
        <div className="space-y-2">
          <Label>Enabled Skills</Label>
          {isLoading ? (
            <Skeleton className="h-20" />
          ) : skills.length === 0 ? (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                No skills found. Add <code className="bg-muted px-1 rounded">SKILL.md</code> files
                to <code className="bg-muted px-1 rounded">{localPath || '.bffless/skills/'}</code> in your deployment.
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
