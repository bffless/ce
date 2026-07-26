import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Play } from 'lucide-react';
import { DOCS, VIDEOS } from '@/lib/docsLinks';
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
}

/**
 * First screen of post-setup onboarding: welcomes the operator, offers the
 * walkthrough video and the first-deployment guide, then hands off to
 * CreateRepoStep.
 *
 * The video is a click-to-load facade: on render it fetches only the static
 * thumbnail from i.ytimg.com, and the tracking-capable player iframe
 * (youtube-nocookie.com) is mounted only once the operator presses play. If
 * i.ytimg.com is blocked or unreachable — a self-hosted instance behind a
 * strict egress policy — onError drops the image and the gradient placeholder
 * plus play button remain, rather than a broken-image icon.
 */
export function WelcomeStep({ onNext, onSkip }: WelcomeStepProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Your instance is up and running. Watch the walkthrough, or jump straight
        in — the next few steps create your first repository, generate an API
        key, and hand you a GitHub Actions workflow to copy.
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

      <DocsLink href={DOCS_URL} label="Read the first-deployment guide" />

      <div className="flex justify-between pt-4">
        <Button type="button" variant="ghost" onClick={onSkip}>
          Skip for now
        </Button>
        <Button type="button" onClick={onNext}>
          Get Started
        </Button>
      </div>
    </div>
  );
}
