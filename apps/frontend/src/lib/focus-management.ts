/**
 * Focus management utilities for accessibility
 *
 * This module provides utilities for improving keyboard navigation and screen reader support.
 * These functions are currently **not integrated** into components but are ready for use.
 *
 * ## Next Steps / Integration Plan:
 *
 * ### 1. trapFocus()
 * **Where to use**: Mobile Sheet drawer (FileBrowserSidebar when in mobile mode)
 * **How**: Call trapFocus() when Sheet opens, store cleanup function, call on close
 * **Example**:
 * ```typescript
 * useEffect(() => {
 *   if (isMobile && sidebarOpen && sheetRef.current) {
 *     const cleanup = trapFocus(sheetRef.current);
 *     return cleanup;
 *   }
 * }, [isMobile, sidebarOpen]);
 * ```
 *
 * ### 2. announceToScreenReader()
 * **Where to use**: Dynamic content changes, user actions
 * **Suggested integrations**:
 * - File selection: "Selected index.html"
 * - Search results: "Found 5 matching files" or "No files match search"
 * - File downloads: "Downloaded index.html"
 * - Copy actions: "URL copied to clipboard"
 * - Error recoveries: "File loaded successfully after retry"
 * - Ref changes: "Switched to branch main"
 *
 * **Example**:
 * ```typescript
 * const handleFileSelect = (path: string) => {
 *   // ... navigation logic ...
 *   announceToScreenReader(`Selected ${path.split('/').pop()}`);
 * };
 * ```
 *
 * ### 3. getContrastRatio()
 * **Purpose**: Testing utility for WCAG compliance
 * **Usage**: Can be used in tests or a contrast checker tool
 * **Example**: Verify that text/background combinations meet WCAG AA (4.5:1) or AAA (7:1)
 *
 * ## Priority for Integration:
 * - **Phase 2H (Testing)**: Add unit tests for these utilities
 * - **Phase 3 (Advanced Features)**: Integrate trapFocus() for modal/drawer components
 * - **Post-v1**: Add screen reader announcements for key user actions
 *
 * ## WCAG 2.1 Guidelines Addressed:
 * - 2.1.2 No Keyboard Trap (trapFocus provides escape mechanism)
 * - 4.1.3 Status Messages (announceToScreenReader for dynamic content)
 * - 1.4.3 Contrast (getContrastRatio for testing minimum contrast)
 */

/**
 * Traps focus within an element (useful for modals, drawers)
 * @param element - The element to trap focus within
 * @returns Cleanup function to remove the trap
 */
export function trapFocus(element: HTMLElement): () => void {
  const focusableSelectors = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const focusableElements = element.querySelectorAll<HTMLElement>(focusableSelectors);
  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;

    if (e.shiftKey) {
      // Shift + Tab
      if (document.activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable?.focus();
      }
    } else {
      // Tab
      if (document.activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable?.focus();
      }
    }
  };

  element.addEventListener('keydown', handleKeyDown);

  // Focus the first element
  firstFocusable?.focus();

  // Return cleanup function
  return () => {
    element.removeEventListener('keydown', handleKeyDown);
  };
}

/**
 * Announces a message to screen readers using aria-live
 * @param message - The message to announce
 * @param priority - The priority level ('polite' or 'assertive')
 */
export function announceToScreenReader(
  message: string,
  priority: 'polite' | 'assertive' = 'polite',
) {
  const announcement = document.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', priority);
  announcement.setAttribute('aria-atomic', 'true');
  announcement.className = 'sr-only'; // Visually hidden but available to screen readers
  announcement.textContent = message;

  document.body.appendChild(announcement);

  // Remove after announcement
  setTimeout(() => {
    document.body.removeChild(announcement);
  }, 1000);
}

/**
 * Gets the contrast ratio between two colors (for WCAG compliance)
 * @param rgb1 - First color as [r, g, b]
 * @param rgb2 - Second color as [r, g, b]
 * @returns The contrast ratio
 */
export function getContrastRatio(
  rgb1: [number, number, number],
  rgb2: [number, number, number],
): number {
  const luminance = ([r, g, b]: [number, number, number]) => {
    const [rs, gs, bs] = [r, g, b].map((c) => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  };

  const l1 = luminance(rgb1);
  const l2 = luminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}
