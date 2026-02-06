import type { Meta, StoryObj } from '@storybook/react';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { api } from '@/services/api';
import { StorageSettings } from './StorageSettings';

// Create a fresh store for each story
const createStore = () =>
  configureStore({
    reducer: {
      [api.reducerPath]: api.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(api.middleware),
  });

// Mock data for setup status
const mockSetupStatus = {
  storageProvider: 's3',
  storageConfigured: true,
  cacheEnabled: true,
  cacheType: 'redis',
};

// Mock data for current storage config
const mockStorageConfig = {
  isConfigured: true,
  isS3Compatible: true,
  endpoint: 'https://sfo3.digitaloceanspaces.com',
  bucket: 'my-assets',
  region: 'us-east-1',
};

// Mock constraints
const mockConstraints = {
  minio: { enabled: true, reason: null },
  redis: { enabled: true, reason: null },
};

// Mock available options for CE mode (all options available except managed)
const mockAvailableOptionsCE = {
  storage: {
    managed: false,
    s3: true,
    gcs: true,
    azure: true,
    minio: true,
    local: true,
  },
  cache: {
    lru: true,
    managedRedis: false,
    localRedis: true,
    externalRedis: true,
  },
  email: {
    managed: false,
    smtp: true,
    sendgrid: true,
    resend: true,
    skipAllowed: true,
  },
};

// Mock available options for Platform mode (managed + BYOB options)
const mockAvailableOptionsPlatform = {
  storage: {
    managed: true,
    s3: true,
    gcs: false,
    azure: false,
    minio: false,
    local: false,
  },
  cache: {
    lru: true,
    managedRedis: true,
    localRedis: false,
    externalRedis: true,
  },
  email: {
    managed: true,
    smtp: false,
    sendgrid: false,
    resend: false,
    skipAllowed: false,
  },
};

// Mock available options for Platform mode with only managed (no BYOB)
const mockAvailableOptionsPlatformManagedOnly = {
  storage: {
    managed: true,
    s3: false,
    gcs: false,
    azure: false,
    minio: false,
    local: false,
  },
  cache: {
    lru: true,
    managedRedis: true,
    localRedis: false,
    externalRedis: false,
  },
  email: {
    managed: true,
    smtp: false,
    sendgrid: false,
    resend: false,
    skipAllowed: false,
  },
};

const meta: Meta<typeof StorageSettings> = {
  title: 'Settings/StorageSettings',
  component: StorageSettings,
  parameters: {
    layout: 'padded',
    // Force iframe rendering on docs page to avoid MSW conflicts with inline stories
    docs: {
      story: {
        inline: false,
        iframeHeight: 500,
      },
    },
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

// Default: S3-compatible storage configured (CE Mode)
export const Default: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/setup/status', () => HttpResponse.json(mockSetupStatus)),
        http.get('/api/setup/storage-config', () => HttpResponse.json(mockStorageConfig)),
        http.get('/api/setup/constraints', () => HttpResponse.json(mockConstraints)),
        http.get('/api/setup/available-options', () => HttpResponse.json(mockAvailableOptionsCE)),
        http.get('/api/migration/job', () => HttpResponse.json({ status: 'none' })),
      ],
    },
  },
};

// Managed Storage (Platform Mode)
export const ManagedStorage: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/setup/status', () =>
          HttpResponse.json({
            ...mockSetupStatus,
            storageProvider: 'managed',
          })
        ),
        http.get('/api/setup/storage-config', () =>
          HttpResponse.json({
            isConfigured: true,
            // No additional config shown for managed storage
          })
        ),
        http.get('/api/setup/constraints', () => HttpResponse.json(mockConstraints)),
        http.get('/api/setup/available-options', () => HttpResponse.json(mockAvailableOptionsPlatform)),
        http.get('/api/migration/job', () => HttpResponse.json({ status: 'none' })),
      ],
    },
  },
};

// Managed Storage Only (No migration possible)
export const ManagedStorageOnly: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/setup/status', () =>
          HttpResponse.json({
            ...mockSetupStatus,
            storageProvider: 'managed',
          })
        ),
        http.get('/api/setup/storage-config', () =>
          HttpResponse.json({
            isConfigured: true,
          })
        ),
        http.get('/api/setup/constraints', () => HttpResponse.json(mockConstraints)),
        http.get('/api/setup/available-options', () => HttpResponse.json(mockAvailableOptionsPlatformManagedOnly)),
        http.get('/api/migration/job', () => HttpResponse.json({ status: 'none' })),
      ],
    },
  },
};

// Local Filesystem
export const LocalFilesystem: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/setup/status', () =>
          HttpResponse.json({
            ...mockSetupStatus,
            storageProvider: 'local',
          })
        ),
        http.get('/api/setup/storage-config', () =>
          HttpResponse.json({
            isConfigured: true,
            localPath: './uploads',
          })
        ),
        http.get('/api/setup/constraints', () => HttpResponse.json(mockConstraints)),
        http.get('/api/setup/available-options', () => HttpResponse.json(mockAvailableOptionsCE)),
        http.get('/api/migration/job', () => HttpResponse.json({ status: 'none' })),
      ],
    },
  },
};

// MinIO Storage
export const MinIOStorage: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/setup/status', () =>
          HttpResponse.json({
            ...mockSetupStatus,
            storageProvider: 'minio',
          })
        ),
        http.get('/api/setup/storage-config', () =>
          HttpResponse.json({
            isConfigured: true,
            endpoint: 'minio',
            port: 9000,
            bucket: 'assets',
          })
        ),
        http.get('/api/setup/constraints', () => HttpResponse.json(mockConstraints)),
        http.get('/api/setup/available-options', () => HttpResponse.json(mockAvailableOptionsCE)),
        http.get('/api/migration/job', () => HttpResponse.json({ status: 'none' })),
      ],
    },
  },
};

// MinIO Disabled Warning
export const MinIODisabledWarning: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/setup/status', () =>
          HttpResponse.json({
            ...mockSetupStatus,
            storageProvider: 'minio',
          })
        ),
        http.get('/api/setup/storage-config', () =>
          HttpResponse.json({
            isConfigured: true,
            endpoint: 'minio',
            port: 9000,
            bucket: 'assets',
          })
        ),
        http.get('/api/setup/constraints', () =>
          HttpResponse.json({
            minio: { enabled: false, reason: 'ENABLE_MINIO=false is set in environment' },
            redis: { enabled: true, reason: null },
          })
        ),
        http.get('/api/setup/available-options', () => HttpResponse.json(mockAvailableOptionsCE)),
        http.get('/api/migration/job', () => HttpResponse.json({ status: 'none' })),
      ],
    },
  },
};

// Migration In Progress
export const MigrationInProgress: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/setup/status', () => HttpResponse.json(mockSetupStatus)),
        http.get('/api/setup/storage-config', () => HttpResponse.json(mockStorageConfig)),
        http.get('/api/setup/constraints', () => HttpResponse.json(mockConstraints)),
        http.get('/api/setup/available-options', () => HttpResponse.json(mockAvailableOptionsCE)),
        http.get('/api/migration/job', () =>
          HttpResponse.json({
            status: 'in_progress',
            sourceProvider: 's3',
            targetProvider: 'gcs',
            totalFiles: 1500,
            processedFiles: 750,
            progress: 50,
          })
        ),
      ],
    },
  },
};

// Loading State
export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/setup/status', async () => {
          await new Promise((resolve) => setTimeout(resolve, 100000));
          return HttpResponse.json(mockSetupStatus);
        }),
        http.get('/api/setup/storage-config', async () => {
          await new Promise((resolve) => setTimeout(resolve, 100000));
          return HttpResponse.json(mockStorageConfig);
        }),
        http.get('/api/setup/constraints', () => HttpResponse.json(mockConstraints)),
        http.get('/api/setup/available-options', () => HttpResponse.json(mockAvailableOptionsCE)),
        http.get('/api/migration/job', () => HttpResponse.json({ status: 'none' })),
      ],
    },
  },
};
