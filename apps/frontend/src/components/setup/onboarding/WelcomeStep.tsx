import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { LayoutGrid, Play, Rocket } from 'lucide-react';
import { APP_STORE_URL, DOCS, VIDEOS } from '@/lib/docsLinks';
import { DocsLink } from '@/components/common/DocsLink';

const VIDEO_ID = VIDEOS.firstDeployment.id;
const VIDEO_TITLE = VIDEOS.firstDeployment.title;
const DOCS_URL = DOCS.gettingStarted.firstDeployment;

// hqdefault always exists for a public video (unlike maxresdefault), and is 4:3
// with letterbox bars — object-cover inside the 16:9 frame crops them off.
const thumbnailUrl = `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`;

interface WelcomeStepProps {
  onNext: () => void;
  onSkip: () => void;
  /** Complete onboarding and route to the in-instance /apps catalog. */
  onInstallApps: () => void;
  /** /apps is admin-only — non-admins keep the single-path welcome. */
  showAppsPath: boolean;
}

/**
 * First screen of post-setup onboarding. For admins it forks into two paths:
 * install a catalog app in one click (/apps — the primary callout), or deploy
 * your own site via the existing repo → API key → GitHub Actions wizard. For
 * non-admin users (who cannot reach /apps) it keeps the single wizard path.
 *
 * The video is a click-to-load facade: on render it fetches only the static
 * thumbnail from i.ytimg.com, and the tracking-capable player iframe
 * (youtube-nocookie.com) is mounted only once the operator presses play. If
 * i.ytimg.com is blocked or unreachable — a self-hosted instance behind a
 * strict egress policy — onError drops the image and the gradient placeholder
 * plus play button remain, rather than a broken-image icon.
 */
export function WelcomeStep({ onNext, onSkip, onInstallApps, showAppsPath }: WelcomeStepProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {showAppsPath
          ? 'Your instance is up and running. Install a ready-made app in one click, or deploy your own site — watch the walkthrough for a tour first if you like.'
          : 'Your instance is up and running. Watch the walkthrough, or jump straight in — the next few steps create your first repository, generate an API key, and hand you a GitHub Actions workflow to copy.'}
      </p>

      <div className="relative aspect-video overflow-hidden rounded-lg bg-gradient-to-br from-zinc-800 to-zinc-900">
        {isPlaying ? (
          <iframe
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0`}
            title={VIDEO_TITLE}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsPlaying(true)}
            aria-label={`Play video: ${VIDEO_TITLE}`}
            className="group absolute inset-0 h-full w-full"
          >
            {!thumbnailFailed && (
              <img
                src={thumbnailUrl}
                alt=""
                loading="lazy"
                onError={() => setThumbnailFailed(true)}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            {/* No caption overlay: YouTube thumbnails usually carry their own
                title art, and text on top of it collides. */}
            <span className="absolute inset-0 bg-black/20 transition-colors group-hover:bg-black/35" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#d96459] shadow-lg transition-transform group-hover:scale-110">
                <Play className="h-6 w-6 translate-x-[1px] fill-white text-white" />
              </span>
            </span>
          </button>
        )}
      </div>

      {showAppsPath ? (
        <>
          <div className="space-y-3">
            <div className="rounded-lg border-2 border-primary/50 bg-primary/5 p-4">
              <div className="flex items-start gap-3">
                <LayoutGrid className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="flex-1 space-y-2">
                  <h3 className="text-sm font-semibold">Install a ready-made app</h3>
                  <p className="text-sm text-muted-foreground">
                    Apps like Handoff install onto this instance in one click — frontend, backend
                    rules, and domain included.
                  </p>
                  <div className="flex items-center gap-3 pt-1">
                    <Button type="button" size="sm" onClick={onInstallApps}>
                      Browse apps
                    </Button>
                    <a
                      href={APP_STORE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      See what's available ↗
                    </a>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <div className="flex items-start gap-3">
                <Rocket className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="flex-1 space-y-2">
                  <h3 className="text-sm font-semibold">Deploy your own site</h3>
                  <p className="text-sm text-muted-foreground">
                    Create a repository, generate an API key, and wire up a GitHub Actions deploy.
                  </p>
                  <div className="pt-1">
                    <Button type="button" variant="outline" size="sm" onClick={onNext}>
                      Create a repository
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DocsLink href={DOCS_URL} label="Read the first-deployment guide" />

          <div className="pt-2">
            <Button type="button" variant="ghost" onClick={onSkip}>
              Skip for now
            </Button>
          </div>
        </>
      ) : (
        <>
          <DocsLink href={DOCS_URL} label="Read the first-deployment guide" />

          <div className="flex justify-between pt-4">
            <Button type="button" variant="ghost" onClick={onSkip}>
              Skip for now
            </Button>
            <Button type="button" onClick={onNext}>
              Get Started
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
