import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, KeyRound, Building2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { OAuthProvider, OAuthProviderKind } from '@/services/authApi';

interface OAuthProviderButtonProps {
  provider: OAuthProvider;
  /** Original redirect URL to return to after sign-in */
  redirectTo?: string;
  /** Override the default "Sign in / up with X" label */
  labelMode?: 'sign-in' | 'sign-up';
}

/**
 * Sign-in button for any OIDC provider returned by /api/auth/oauth/providers.
 * Renames + generalises the old GoogleSignInButton.
 *
 * On click:
 *   1. Stash provider id, callback URL, original-redirect, and (after the GET)
 *      the PKCE verifier in sessionStorage. The callback page (`OAuthSignInCallbackPage`)
 *      reads them.
 *   2. Hit /api/auth/oauth/:providerId/url and redirect to the IdP.
 *
 * `oauth_provider_id` is the new sessionStorage key — required so the
 * callback page knows which `:providerId` to POST back to. Older bundles only
 * needed sessionStorage keys for redirect+PKCE; provider was implicit (Google).
 */
export function OAuthProviderButton({
  provider,
  redirectTo,
  labelMode = 'sign-in',
}: OAuthProviderButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleClick = async () => {
    setIsLoading(true);

    try {
      const callbackUrl = `${window.location.origin}/oauth/signin/callback`;

      sessionStorage.setItem('oauth_provider_id', provider.id);
      sessionStorage.setItem('oauth_provider_display_name', provider.displayName);
      sessionStorage.setItem('oauth_redirect_url', callbackUrl);
      if (redirectTo && redirectTo !== '/') {
        sessionStorage.setItem('oauth_original_redirect', redirectTo);
      }

      const response = await fetch(
        `/api/auth/oauth/${encodeURIComponent(provider.id)}/url?redirectUrl=${encodeURIComponent(callbackUrl)}`,
        { credentials: 'include' },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || `Failed to get ${provider.displayName} sign-in URL`);
      }

      const data = await response.json();

      if (data.pkceCodeVerifier) {
        sessionStorage.setItem('oauth_pkce_code_verifier', data.pkceCodeVerifier);
      }

      window.location.href = data.url;
    } catch (error) {
      setIsLoading(false);
      toast({
        title: `${provider.displayName} sign-in failed`,
        description:
          error instanceof Error
            ? error.message
            : `Could not initiate ${provider.displayName} sign-in`,
        variant: 'destructive',
      });
    }
  };

  const verb = labelMode === 'sign-up' ? 'Sign up with' : 'Sign in with';
  const label = `${verb} ${provider.displayName}`;

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={handleClick}
      disabled={isLoading}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <span className="mr-2 inline-flex items-center">{iconForKind(provider.kind)}</span>
      )}
      {label}
    </Button>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function iconForKind(kind: OAuthProviderKind) {
  switch (kind) {
    case 'google':
      return GOOGLE_ICON;
    case 'azure-ad':
      return <Building2 className="h-4 w-4" />;
    case 'okta':
      return OKTA_ICON;
    case 'oidc':
    default:
      return <KeyRound className="h-4 w-4" />;
  }
}

const GOOGLE_ICON = (
  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

// Simple Okta-blue circle with O — Okta's brand guidelines forbid using the
// trademarked logo without a license, so we approximate with a recognisable
// glyph instead. Same reasoning as the Microsoft logo above (lucide
// Building2).
const OKTA_ICON = (
  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="11" fill="#007DC1" />
    <circle cx="12" cy="12" r="5.5" fill="none" stroke="white" strokeWidth="2" />
  </svg>
);
