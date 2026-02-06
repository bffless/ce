import { Link } from 'react-router-dom';
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

interface RepoBreadcrumbProps {
  owner: string;
  repo: string;
  gitRef?: string;
  filepath?: string;
  /** Optional suffix label (e.g., "Settings") that is not treated as a file path */
  suffixLabel?: string;
}

export function RepoBreadcrumb({ owner, repo, gitRef, filepath, suffixLabel }: RepoBreadcrumbProps) {
  // Parse filepath into segments
  const pathSegments = filepath ? filepath.split('/').filter(Boolean) : [];

  // Build the cumulative path for each segment
  const buildPath = (index: number) => {
    const segments = pathSegments.slice(0, index + 1);
    return `/repo/${owner}/${repo}/${gitRef}/${segments.join('/')}`;
  };

  // Determine if we should show ellipsis on mobile (>3 path segments)
  const shouldTruncateOnMobile = pathSegments.length > 3;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {/* Owner/Repo - Link to repo overview */}
        <BreadcrumbItem>
          <Link to={`/repo/${owner}/${repo}`} className="transition-colors hover:text-foreground">
            {owner} / {repo}
          </Link>
        </BreadcrumbItem>

        {/* Ref - Link to repo at specific ref */}
        {gitRef && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <Link
                to={`/repo/${owner}/${repo}/${gitRef}`}
                className="transition-colors hover:text-foreground"
              >
                {gitRef}
              </Link>
            </BreadcrumbItem>
          </>
        )}

        {/* Path segments */}
        {pathSegments.length > 0 && (
          <>
            {shouldTruncateOnMobile && (
              <>
                {/* Show separator and ellipsis on mobile, hide on larger screens */}
                <BreadcrumbSeparator className="md:hidden" />
                <BreadcrumbItem className="md:hidden">
                  <BreadcrumbEllipsis />
                </BreadcrumbItem>
              </>
            )}

            {pathSegments.map((segment, index) => {
              const isLast = index === pathSegments.length - 1;
              const path = buildPath(index);

              // On mobile, only show first and last segment when truncated
              const hiddenOnMobile =
                shouldTruncateOnMobile && index !== 0 && index !== pathSegments.length - 1;

              return (
                <div key={path} className={hiddenOnMobile ? 'hidden md:contents' : 'contents'}>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    {isLast ? (
                      // Current file - not a link
                      <BreadcrumbPage>{segment}</BreadcrumbPage>
                    ) : (
                      // Parent directories - clickable
                      <Link to={path} className="transition-colors hover:text-foreground">
                        {segment}
                      </Link>
                    )}
                  </BreadcrumbItem>
                </div>
              );
            })}
          </>
        )}

        {/* Suffix label (e.g., Settings) */}
        {suffixLabel && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{suffixLabel}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
