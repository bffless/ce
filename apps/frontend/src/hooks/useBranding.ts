import { useGetPublicBrandingQuery } from '@/services/settingsApi';
import defaultLogoSvg from '@/assets/logo.svg';
import defaultAuthLogoSvg from '@/assets/logo-circle-wire-text.svg';

const DEFAULT_SITE_NAME = 'BFFLESS';

export function useBranding() {
  const { data, isLoading } = useGetPublicBrandingQuery();

  const siteName = data?.siteName || DEFAULT_SITE_NAME;
  const hasHeaderLogo = data?.hasHeaderLogo ?? false;
  const hasAuthLogo = data?.hasAuthLogo ?? false;

  // Use custom logo URL if set, otherwise fall back to default SVGs
  const headerLogoUrl = hasHeaderLogo
    ? '/api/settings/branding/logo/header'
    : defaultLogoSvg;

  const authLogoUrl = hasAuthLogo
    ? '/api/settings/branding/logo/auth'
    : defaultAuthLogoSvg;

  return {
    siteName,
    headerLogoUrl,
    authLogoUrl,
    hasHeaderLogo,
    hasAuthLogo,
    isLoading,
  };
}
