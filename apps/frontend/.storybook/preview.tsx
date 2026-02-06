import type { Preview } from '@storybook/react';
import { initialize, mswLoader } from 'msw-storybook-addon';

// Import Tailwind CSS
import '../src/index.css';

// Initialize MSW with relative path for subdirectory deployment
initialize({
  serviceWorker: {
    url: './mockServiceWorker.js',
  },
});

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#ffffff' },
        { name: 'dark', value: '#0a0a0a' },
      ],
    },
  },
  loaders: [mswLoader],
  decorators: [
    (Story, context) => {
      // Apply dark class to storybook root when dark background is selected
      const isDark = context.globals.backgrounds?.value === '#0a0a0a';
      document.documentElement.classList.toggle('dark', isDark);
      return <Story />;
    },
  ],
};

export default preview;
