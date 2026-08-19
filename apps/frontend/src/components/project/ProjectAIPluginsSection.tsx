import { useState } from 'react';
import {
  useListProjectPluginsQuery,
  useEnableProjectPluginMutation,
  useDisableProjectPluginMutation,
  useUpdateProjectPluginConfigMutation,
  useLazyInitiatePluginOAuthQuery,
  useDisconnectPluginOAuthMutation,
  PluginListItem,
  Project,
} from '@/services/projectsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Loader2,
  Puzzle,
  Calculator,
  Search,
  Calendar,
  Database,
  Settings2,
  ExternalLink,
  Unplug,
  Mail,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useParams } from 'react-router-dom';

// Icon mapping for plugins
const PLUGIN_ICONS: Record<string, React.ElementType> = {
  calculator: Calculator,
  search: Search,
  calendar: Calendar,
  database: Database,
  mail: Mail,
};

// Category display config
const CATEGORY_COLORS: Record<string, string> = {
  utility: 'bg-blue-50 text-blue-700',
  information: 'bg-purple-50 text-purple-700',
  scheduling: 'bg-green-50 text-green-700',
  communication: 'bg-orange-50 text-orange-700',
};

function PluginCard({
  plugin,
  onToggle,
  onConfigure,
  onConnectOAuth,
  onDisconnectOAuth,
  isToggling,
  isConnecting,
}: {
  plugin: PluginListItem;
  onToggle: (enabled: boolean) => void;
  onConfigure: () => void;
  onConnectOAuth: () => void;
  onDisconnectOAuth: () => void;
  isToggling: boolean;
  isConnecting: boolean;
}) {
  const Icon = PLUGIN_ICONS[plugin.icon || ''] || Puzzle;
  const categoryColor = CATEGORY_COLORS[plugin.category] || 'bg-gray-50 text-gray-700';
  const isOAuthPlugin = plugin.requiresOAuth;
  const isOAuthConnected = isOAuthPlugin && plugin.oauthConnectedEmail;
  const needsOAuthConnect =
    isOAuthPlugin && plugin.enabled && !plugin.oauthConnectedEmail && plugin.hasConfig;

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-muted">
            <Icon className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-sm">{plugin.name}</h4>
              <Badge variant="outline" className={cn('text-xs', categoryColor)}>
                {plugin.category}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{plugin.description}</p>

            {/* OAuth connected state */}
            {isOAuthConnected && (
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="secondary" className="text-xs font-normal">
                  Connected: {plugin.oauthConnectedEmail}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                  onClick={onDisconnectOAuth}
                >
                  <Unplug className="h-3 w-3 mr-1" />
                  Disconnect
                </Button>
              </div>
            )}

            {/* OAuth needs connect */}
            {needsOAuthConnect && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-7 text-xs"
                onClick={onConnectOAuth}
                disabled={isConnecting}
              >
                {isConnecting ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <ExternalLink className="h-3 w-3 mr-1" />
                )}
                Connect Google Account
              </Button>
            )}

            {/* Configure button */}
            {plugin.enabled && plugin.configSchema && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 h-7 px-2 text-xs"
                onClick={onConfigure}
              >
                <Settings2 className="h-3 w-3 mr-1" />
                Configure
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isToggling ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Switch checked={plugin.enabled} onCheckedChange={onToggle} />
          )}
        </div>
      </div>
    </div>
  );
}

function PluginConfigDialog({
  plugin,
  open,
  onOpenChange,
  onSave,
  isSaving,
}: {
  plugin: PluginListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: Record<string, unknown>) => void;
  isSaving: boolean;
}) {
  const [configValues, setConfigValues] = useState<Record<string, string>>({});

  if (!plugin) return null;

  // Derive config fields from plugin metadata
  const configFields = getConfigFieldsForPlugin(plugin.id);

  const handleSave = () => {
    const config: Record<string, unknown> = {};
    for (const field of configFields) {
      config[field.key] = configValues[field.key] || '';
    }
    onSave(config);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Configure {plugin.name}</DialogTitle>
          <DialogDescription>Enter the required credentials for this plugin.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {configFields.map((field) => (
            <div key={field.key}>
              <Label htmlFor={`plugin-${field.key}`}>{field.label}</Label>
              <Input
                id={`plugin-${field.key}`}
                type={field.secret ? 'password' : 'text'}
                value={configValues[field.key] || ''}
                onChange={(e) =>
                  setConfigValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
                placeholder={field.placeholder}
                className="mt-1"
              />
              {field.helpText && (
                <p className="mt-1 text-xs text-muted-foreground">{field.helpText}</p>
              )}
            </div>
          ))}

          {configFields.length === 0 && (
            <p className="text-sm text-muted-foreground">
              This plugin does not require any configuration.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Configuration'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ConfigField {
  key: string;
  label: string;
  placeholder?: string;
  helpText?: string;
  secret?: boolean;
}

function getConfigFieldsForPlugin(pluginId: string): ConfigField[] {
  switch (pluginId) {
    case 'web-search':
      return [
        {
          key: 'apiKey',
          label: 'Google Custom Search API Key',
          placeholder: 'AIza...',
          helpText: 'Get your API key from the Google Cloud Console',
          secret: true,
        },
        {
          key: 'searchEngineId',
          label: 'Search Engine ID',
          placeholder: 'abc123...',
          helpText: 'The Custom Search Engine ID (cx parameter)',
        },
      ];
    case 'google-calendar':
      return [
        {
          key: 'clientId',
          label: 'Google OAuth Client ID',
          placeholder: 'xxxxx.apps.googleusercontent.com',
          helpText: 'From Google Cloud Console > APIs & Services > Credentials',
        },
        {
          key: 'clientSecret',
          label: 'Google OAuth Client Secret',
          placeholder: 'GOCSPX-...',
          secret: true,
          helpText: 'The client secret for your OAuth 2.0 application',
        },
      ];
    default:
      return [];
  }
}

interface ProjectAIPluginsSectionProps {
  project: Project;
}

export function ProjectAIPluginsSection({ project }: ProjectAIPluginsSectionProps) {
  const { toast } = useToast();
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { data: plugins, isLoading } = useListProjectPluginsQuery(project.id);
  const [enablePlugin] = useEnableProjectPluginMutation();
  const [disablePlugin] = useDisableProjectPluginMutation();
  const [updatePluginConfig, { isLoading: isUpdatingConfig }] =
    useUpdateProjectPluginConfigMutation();
  const [initiateOAuth] = useLazyInitiatePluginOAuthQuery();
  const [disconnectOAuth] = useDisconnectPluginOAuthMutation();

  const [togglingPlugin, setTogglingPlugin] = useState<string | null>(null);
  const [connectingPlugin, setConnectingPlugin] = useState<string | null>(null);
  const [configuringPlugin, setConfiguringPlugin] = useState<PluginListItem | null>(null);

  const handleToggle = async (plugin: PluginListItem, enabled: boolean) => {
    setTogglingPlugin(plugin.id);
    try {
      if (enabled) {
        // If plugin needs config, open the config dialog instead
        const configFields = getConfigFieldsForPlugin(plugin.id);
        if (configFields.length > 0 && !plugin.hasConfig) {
          setConfiguringPlugin(plugin);
          setTogglingPlugin(null);
          return;
        }
        await enablePlugin({ projectId: project.id, pluginId: plugin.id }).unwrap();
        toast({ title: `${plugin.name} enabled` });
      } else {
        await disablePlugin({ projectId: project.id, pluginId: plugin.id }).unwrap();
        toast({ title: `${plugin.name} disabled` });
      }
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      toast({
        title: 'Error',
        description: err.data?.message || `Failed to ${enabled ? 'enable' : 'disable'} plugin`,
        variant: 'destructive',
      });
    } finally {
      setTogglingPlugin(null);
    }
  };

  const handleSaveConfig = async (config: Record<string, unknown>) => {
    if (!configuringPlugin) return;
    try {
      if (configuringPlugin.enabled) {
        await updatePluginConfig({
          projectId: project.id,
          pluginId: configuringPlugin.id,
          config,
        }).unwrap();
      } else {
        await enablePlugin({
          projectId: project.id,
          pluginId: configuringPlugin.id,
          config,
        }).unwrap();
      }
      toast({ title: `${configuringPlugin.name} configured` });
      setConfiguringPlugin(null);
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      toast({
        title: 'Error',
        description: err.data?.message || 'Failed to save plugin configuration',
        variant: 'destructive',
      });
    }
  };

  const handleConnectOAuth = async (plugin: PluginListItem) => {
    setConnectingPlugin(plugin.id);
    try {
      const redirectUri = window.location.origin + '/oauth/callback';

      // Store context for the callback page
      sessionStorage.setItem(
        'oauth_plugin_context',
        JSON.stringify({
          projectId: project.id,
          pluginId: plugin.id,
          owner,
          repo,
        }),
      );

      const result = await initiateOAuth({
        projectId: project.id,
        pluginId: plugin.id,
        redirectUri,
      }).unwrap();

      // Redirect to Google OAuth
      window.location.href = result.authUrl;
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      toast({
        title: 'Error',
        description: err.data?.message || 'Failed to initiate OAuth connection',
        variant: 'destructive',
      });
      setConnectingPlugin(null);
    }
  };

  const handleDisconnectOAuth = async (plugin: PluginListItem) => {
    try {
      await disconnectOAuth({
        projectId: project.id,
        pluginId: plugin.id,
      }).unwrap();
      toast({ title: `${plugin.name} disconnected` });
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      toast({
        title: 'Error',
        description: err.data?.message || 'Failed to disconnect',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Puzzle className="h-5 w-5" />
            AI Plugins
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const pluginList = plugins || [];
  const enabledCount = pluginList.filter((p) => p.enabled).length;

  return (
    <>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Puzzle className="h-5 w-5" />
            AI Plugins
          </CardTitle>
          <CardDescription>
            Enable plugins to give your AI chat tools that can perform actions like calculations,
            web searches, and more.
            {enabledCount > 0 && (
              <span className="ml-1 font-medium">
                {enabledCount} plugin{enabledCount > 1 ? 's' : ''} enabled.
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {pluginList.length > 0 ? (
            pluginList.map((plugin) => (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                onToggle={(enabled) => handleToggle(plugin, enabled)}
                onConfigure={() => setConfiguringPlugin(plugin)}
                onConnectOAuth={() => handleConnectOAuth(plugin)}
                onDisconnectOAuth={() => handleDisconnectOAuth(plugin)}
                isToggling={togglingPlugin === plugin.id}
                isConnecting={connectingPlugin === plugin.id}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">No plugins available.</p>
          )}
        </CardContent>
      </Card>

      <PluginConfigDialog
        plugin={configuringPlugin}
        open={!!configuringPlugin}
        onOpenChange={(open) => {
          if (!open) setConfiguringPlugin(null);
        }}
        onSave={handleSaveConfig}
        isSaving={isUpdatingConfig}
      />
    </>
  );
}
