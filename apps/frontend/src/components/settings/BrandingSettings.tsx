import { useState, useRef } from 'react';
import {
  useGetBrandingQuery,
  useUpdateBrandingMutation,
  useUploadBrandingLogoMutation,
  useDeleteBrandingLogoMutation,
} from '@/services/settingsApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Palette, Upload, Trash2, XCircle, Loader2, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

function LogoUploadField({
  type,
  label,
  description,
  currentKey,
}: {
  type: 'header' | 'auth';
  label: string;
  description: string;
  currentKey: string | null;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadLogo, { isLoading: isUploading }] = useUploadBrandingLogoMutation();
  const [deleteLogo, { isLoading: isDeleting }] = useDeleteBrandingLogoMutation();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate client-side
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Logo must be 2MB or less',
        variant: 'destructive',
      });
      return;
    }

    const allowed = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      toast({
        title: 'Invalid file type',
        description: 'Use PNG, JPG, SVG, WebP, or GIF',
        variant: 'destructive',
      });
      return;
    }

    try {
      await uploadLogo({ type, file }).unwrap();
      toast({ title: 'Logo uploaded', description: `${label} has been updated.` });
    } catch (err: any) {
      toast({
        title: 'Upload failed',
        description: err?.data?.message || 'Failed to upload logo',
        variant: 'destructive',
      });
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDelete = async () => {
    try {
      await deleteLogo({ type }).unwrap();
      toast({ title: 'Logo removed', description: `${label} has been reset to default.` });
    } catch (err: any) {
      toast({
        title: 'Delete failed',
        description: err?.data?.message || 'Failed to delete logo',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-base font-medium">{label}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <div className="flex items-center gap-4">
        {currentKey ? (
          <div className="flex items-center gap-3">
            <img
              src={`/api/settings/branding/logo/${type}?t=${Date.now()}`}
              alt={label}
              className={type === 'header' ? 'h-8 w-8 object-contain' : 'h-20 w-20 object-contain'}
            />
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1" />
              )}
              Remove
            </Button>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground italic">Using default logo</div>
        )}

        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
            onChange={handleFileChange}
            className="hidden"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Upload className="h-4 w-4 mr-1" />
            )}
            {currentKey ? 'Replace' : 'Upload'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function BrandingSettings() {
  const { toast } = useToast();
  const { data: branding, isLoading, error } = useGetBrandingQuery();
  const [updateBranding, { isLoading: isUpdating }] = useUpdateBrandingMutation();
  const [siteName, setSiteName] = useState<string | null>(null);

  // Use local state if user has edited, otherwise show server value
  const displayName = siteName ?? branding?.siteName ?? 'BFFLESS';

  const handleSaveName = async () => {
    if (!siteName || siteName === branding?.siteName) return;

    try {
      await updateBranding({ siteName }).unwrap();
      toast({ title: 'Site name updated', description: `Site name changed to "${siteName}".` });
      setSiteName(null); // Reset local state to track server value
    } catch (err: any) {
      toast({
        title: 'Update failed',
        description: err?.data?.message || 'Failed to update site name',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            <div>
              <CardTitle>Branding</CardTitle>
              <CardDescription>Customize your site's logo and name</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            <div>
              <CardTitle>Branding</CardTitle>
              <CardDescription>Customize your site's logo and name</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>Failed to load branding settings. Please try again.</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const hasChanges = siteName !== null && siteName !== branding?.siteName;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Palette className="h-5 w-5" />
          <div>
            <CardTitle>Branding</CardTitle>
            <CardDescription>
              Customize the site name and logos shown on login, signup, and navigation
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Site Name */}
        <div className="space-y-2">
          <Label htmlFor="site-name" className="text-base font-medium">
            Site Name
          </Label>
          <p className="text-sm text-muted-foreground">
            Displayed in the header navigation and browser tab
          </p>
          <div className="flex items-center gap-2">
            <Input
              id="site-name"
              value={displayName}
              onChange={(e) => setSiteName(e.target.value)}
              placeholder="Enter site name"
              maxLength={100}
              className="max-w-xs"
            />
            {hasChanges && (
              <Button size="sm" onClick={handleSaveName} disabled={isUpdating}>
                {isUpdating ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                Save
              </Button>
            )}
          </div>
        </div>

        <div className="border-t pt-6" />

        {/* Header Logo */}
        <LogoUploadField
          type="header"
          label="Header Logo"
          description="Small icon shown in the top-left navigation bar (recommended: 40x40px)"
          currentKey={branding?.headerLogoKey ?? null}
        />

        <div className="border-t pt-6" />

        {/* Auth Page Logo */}
        <LogoUploadField
          type="auth"
          label="Auth Page Logo"
          description="Large logo shown on login, signup, and password reset pages (recommended: 200x200px)"
          currentKey={branding?.authLogoKey ?? null}
        />
      </CardContent>
    </Card>
  );
}
