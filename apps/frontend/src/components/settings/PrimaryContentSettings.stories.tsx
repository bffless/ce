import type { Meta, StoryObj } from '@storybook/react';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { api } from '@/services/api';
import { PrimaryContentSettings } from './PrimaryContentSettings';

// Create a fresh store for each story
const createStore = () =>
  configureStore({
    reducer: {
      [api.reducerPath]: api.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(api.middleware),
  });

// Mock data
const mockProjects = {
  projects: [
    {
      id: 'proj-1',
      owner: 'acme',
      name: 'website',
      aliases: ['production', 'staging', 'preview'],
    },
    {
      id: 'proj-2',
      owner: 'acme',
      name: 'docs',
      aliases: ['latest', 'v1.0'],
    },
    {
      id: 'proj-3',
      owner: 'acme',
      name: 'storybook',
      aliases: ['main'],
    },
  ],
};

const baseConfig = {
  enabled: true,
  projectId: 'proj-1',
  projectOwner: 'acme',
  projectName: 'website',
  alias: 'production',
  path: '/apps/frontend/storybook-static',
  wwwEnabled: true,
  wwwBehavior: 'redirect-to-www' as const,
  isSpa: false,
  updatedAt: new Date().toISOString(),
};

const meta: Meta<typeof PrimaryContentSettings> = {
  title: 'Settings/PrimaryContentSettings',
  component: PrimaryContentSettings,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => {
      const store = createStore();
      return (
        <Provider store={store}>
          <div className="w-full max-w-2xl mx-auto">
            <Story />
          </div>
        </Provider>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Default: WWW enabled with redirect-to-www behavior
export const Default: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/settings/primary-content', () => {
          return HttpResponse.json(baseConfig);
        }),
        http.get('/api/settings/primary-content/projects', () => {
          return HttpResponse.json(mockProjects);
        }),
        http.patch('/api/settings/primary-content', async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            success: true,
            config: { ...baseConfig, ...body },
            message: 'Primary content updated. Changes will apply within 5 seconds.',
          });
        }),
      ],
    },
  },
};

// WWW Disabled - only serve on root domain
export const WwwDisabled: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/settings/primary-content', () => {
          return HttpResponse.json({
            ...baseConfig,
            wwwEnabled: false,
          });
        }),
        http.get('/api/settings/primary-content/projects', () => {
          return HttpResponse.json(mockProjects);
        }),
        http.patch('/api/settings/primary-content', async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            success: true,
            config: { ...baseConfig, wwwEnabled: false, ...body },
            message: 'Primary content updated. Changes will apply within 5 seconds.',
          });
        }),
      ],
    },
  },
};

// WWW enabled with redirect-to-root behavior
export const RedirectToRoot: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/settings/primary-content', () => {
          return HttpResponse.json({
            ...baseConfig,
            wwwEnabled: true,
            wwwBehavior: 'redirect-to-root',
          });
        }),
        http.get('/api/settings/primary-content/projects', () => {
          return HttpResponse.json(mockProjects);
        }),
        http.patch('/api/settings/primary-content', async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            success: true,
            config: { ...baseConfig, ...body },
            message: 'Primary content updated. Changes will apply within 5 seconds.',
          });
        }),
      ],
    },
  },
};

// WWW enabled with serve-both behavior
export const ServeBoth: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/settings/primary-content', () => {
          return HttpResponse.json({
            ...baseConfig,
            wwwEnabled: true,
            wwwBehavior: 'serve-both',
          });
        }),
        http.get('/api/settings/primary-content/projects', () => {
          return HttpResponse.json(mockProjects);
        }),
        http.patch('/api/settings/primary-content', async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            success: true,
            config: { ...baseConfig, ...body },
            message: 'Primary content updated. Changes will apply within 5 seconds.',
          });
        }),
      ],
    },
  },
};

// Primary content disabled
export const Disabled: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/settings/primary-content', () => {
          return HttpResponse.json({
            enabled: false,
            projectId: null,
            alias: null,
            path: null,
            wwwEnabled: true,
            wwwBehavior: 'redirect-to-www',
            isSpa: false,
            updatedAt: new Date().toISOString(),
          });
        }),
        http.get('/api/settings/primary-content/projects', () => {
          return HttpResponse.json(mockProjects);
        }),
        http.patch('/api/settings/primary-content', async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            success: true,
            config: { ...baseConfig, enabled: false, ...body },
            message: 'Primary content updated. Changes will apply within 5 seconds.',
          });
        }),
      ],
    },
  },
};

// SPA mode enabled
export const SpaMode: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/settings/primary-content', () => {
          return HttpResponse.json({
            ...baseConfig,
            isSpa: true,
          });
        }),
        http.get('/api/settings/primary-content/projects', () => {
          return HttpResponse.json(mockProjects);
        }),
        http.patch('/api/settings/primary-content', async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            success: true,
            config: { ...baseConfig, ...body },
            message: 'Primary content updated. Changes will apply within 5 seconds.',
          });
        }),
      ],
    },
  },
};

// Loading state
export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/settings/primary-content', async () => {
          // Simulate slow network
          await new Promise((resolve) => setTimeout(resolve, 100000));
          return HttpResponse.json(baseConfig);
        }),
        http.get('/api/settings/primary-content/projects', async () => {
          await new Promise((resolve) => setTimeout(resolve, 100000));
          return HttpResponse.json(mockProjects);
        }),
      ],
    },
  },
};

// Error state
export const Error: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/settings/primary-content', () => {
          return HttpResponse.json(
            { message: 'Failed to load settings' },
            { status: 500 }
          );
        }),
        http.get('/api/settings/primary-content/projects', () => {
          return HttpResponse.json(mockProjects);
        }),
      ],
    },
  },
};

// No projects available
export const NoProjects: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/settings/primary-content', () => {
          return HttpResponse.json({
            enabled: false,
            projectId: null,
            alias: null,
            path: null,
            wwwEnabled: true,
            wwwBehavior: 'redirect-to-www',
            isSpa: false,
            updatedAt: new Date().toISOString(),
          });
        }),
        http.get('/api/settings/primary-content/projects', () => {
          return HttpResponse.json({ projects: [] });
        }),
      ],
    },
  },
};
