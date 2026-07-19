import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface TabScrollerProps {
  className?: string;
  children: React.ReactNode;
}

/**
 * Horizontal scroll container for tab strips that can be wider than the viewport
 * (e.g. the 7-tab repository nav at phone widths). Wraps the stock shadcn
 * TabsList at the call site so the primitive stays unmodified.
 *
 * - scrolls the active trigger into view on mount
 * - fades the clipped edges so hidden tabs are discoverable on touch screens
 * - hides the scrollbar; the cut-off tab plus edge fade is the affordance
 */
export function TabScroller({ className, children }: TabScrollerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });

  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setFade({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Center the active trigger when the strip overflows
    const active = el.querySelector<HTMLElement>('[data-state="active"], [aria-current="page"]');
    if (active && el.scrollWidth > el.clientWidth) {
      el.scrollLeft = Math.max(0, active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2);
    }
    updateFade();
    window.addEventListener('resize', updateFade);
    return () => window.removeEventListener('resize', updateFade);
  }, [updateFade]);

  return (
    <div className={cn('relative', className)}>
      <div
        ref={scrollRef}
        onScroll={updateFade}
        className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-background to-transparent transition-opacity',
          fade.left ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent transition-opacity',
          fade.right ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}
