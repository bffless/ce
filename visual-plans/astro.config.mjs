import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';

// Static output by default — `astro build` emits plain HTML to dist/.
// React components render to static HTML; no client JS ships unless a
// component is explicitly hydrated with a client:* directive.
export default defineConfig({
  integrations: [react(), mdx()],
});
