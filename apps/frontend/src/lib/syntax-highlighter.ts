/**
 * Lazy-loaded syntax highlighter using Shiki
 *
 * This module delays loading the heavy Shiki bundle until it's actually needed,
 * improving initial page load performance.
 */

import type { BundledLanguage, BundledTheme } from 'shiki';

let shikiPromise: Promise<typeof import('shiki')> | null = null;

/**
 * Lazy-loads the Shiki library
 */
function loadShiki() {
  if (!shikiPromise) {
    shikiPromise = import('shiki');
  }
  return shikiPromise;
}

/**
 * Highlights code with syntax highlighting
 * @param code - The code to highlight
 * @param lang - The language identifier
 * @param theme - The theme to use
 * @returns HTML string with syntax highlighting
 */
export async function highlightCode(
  code: string,
  lang: BundledLanguage | string,
  theme: BundledTheme | string,
): Promise<string> {
  try {
    const shiki = await loadShiki();
    const html = await shiki.codeToHtml(code, {
      lang: lang as BundledLanguage,
      theme: theme as BundledTheme,
    });
    return html;
  } catch (error) {
    console.error('Failed to highlight code:', error);
    // Fallback: return plain text wrapped in pre/code
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
    return `<pre class="shiki"><code>${escapedCode}</code></pre>`;
  }
}
