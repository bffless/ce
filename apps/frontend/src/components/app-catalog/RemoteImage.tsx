import { useState, type ReactNode } from 'react';

interface RemoteImageProps {
  /** Absent renders the fallback straight away — no <img> is mounted. */
  src?: string;
  alt: string;
  className?: string;
  /** Rendered when `src` is absent or the image fails to load. */
  fallback?: ReactNode;
}

/**
 * An `<img>` for a URL this instance may not be able to reach.
 *
 * Catalog imagery (icon, thumbnail, screenshots) is hosted on the registry's
 * origin — apps.bffless.dev by default — so a self-hosted CE behind strict
 * egress, or one pointed at a registry whose assets have moved, simply can't
 * load it. The rule (same as `components/setup/onboarding/WelcomeStep.tsx`)
 * is that a broken-image icon must never reach the operator: fall back to
 * whatever the caller supplies, usually nothing at all.
 */
export function RemoteImage({ src, alt, className, fallback = null }: RemoteImageProps) {
  // Keyed by URL rather than a bare boolean so a re-render with a different
  // src (a catalog refetch after an app updates its assets) gets a fresh try.
  const [failedSrc, setFailedSrc] = useState<string | undefined>(undefined);

  if (!src || failedSrc === src) return <>{fallback}</>;

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailedSrc(src)}
      className={className}
    />
  );
}
