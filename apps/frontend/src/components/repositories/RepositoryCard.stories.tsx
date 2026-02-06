import type { Meta, StoryObj } from '@storybook/react';
import { MemoryRouter } from 'react-router-dom';
import { RepositoryCard } from './RepositoryCard';
import type { FeedRepository } from '@/services/repositoriesApi';

const meta: Meta<typeof RepositoryCard> = {
  title: 'Components/RepositoryCard',
  component: RepositoryCard,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div className="w-full max-w-2xl">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

const baseRepository: FeedRepository = {
  id: '1',
  owner: 'acme',
  name: 'webapp',
  displayName: 'Web Application',
  description: 'Main web application frontend built with React and TypeScript',
  isPublic: false,
  permissionType: 'owner',
  role: 'admin',
  stats: {
    deploymentCount: 42,
    storageBytes: 1024 * 1024 * 50, // 50 MB
    storageMB: 50,
    lastDeployedAt: new Date().toISOString(),
  },
  createdAt: '2024-01-15T10:00:00Z',
  updatedAt: new Date().toISOString(),
};

export const Default: Story = {
  args: {
    repository: baseRepository,
  },
};

export const PublicRepository: Story = {
  args: {
    repository: {
      ...baseRepository,
      isPublic: true,
      permissionType: 'public',
      role: null,
    },
  },
};

export const WithDirectPermission: Story = {
  args: {
    repository: {
      ...baseRepository,
      permissionType: 'direct',
      role: 'contributor',
    },
  },
};

export const WithGroupPermission: Story = {
  args: {
    repository: {
      ...baseRepository,
      permissionType: 'group',
      role: 'viewer',
    },
  },
};

export const NoDescription: Story = {
  args: {
    repository: {
      ...baseRepository,
      description: null,
      displayName: null,
    },
  },
};

export const NeverDeployed: Story = {
  args: {
    repository: {
      ...baseRepository,
      stats: {
        deploymentCount: 0,
        storageBytes: 0,
        storageMB: 0,
        lastDeployedAt: null,
      },
    },
  },
};

export const LargeStorage: Story = {
  args: {
    repository: {
      ...baseRepository,
      stats: {
        deploymentCount: 256,
        storageBytes: 1024 * 1024 * 1024 * 2.5, // 2.5 GB
        storageMB: 2560,
        lastDeployedAt: '2024-11-15T09:00:00Z',
      },
    },
  },
};

export const SingleDeployment: Story = {
  args: {
    repository: {
      ...baseRepository,
      stats: {
        deploymentCount: 1,
        storageBytes: 1024 * 512, // 512 KB
        storageMB: 0.5,
        lastDeployedAt: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
      },
    },
  },
};

// Grid of multiple cards
export const Grid: Story = {
  render: () => (
    <div className="w-full max-w-4xl grid gap-4 md:grid-cols-2">
      <RepositoryCard
        repository={{
          ...baseRepository,
          id: '1',
          name: 'webapp',
          displayName: 'Web Application',
        }}
      />
      <RepositoryCard
        repository={{
          ...baseRepository,
          id: '2',
          name: 'docs',
          displayName: 'Documentation',
          isPublic: true,
          permissionType: 'direct',
          role: 'contributor',
          stats: { ...baseRepository.stats, deploymentCount: 15 },
        }}
      />
      <RepositoryCard
        repository={{
          ...baseRepository,
          id: '3',
          name: 'api',
          displayName: null,
          description: null,
          permissionType: 'group',
          role: 'viewer',
        }}
      />
      <RepositoryCard
        repository={{
          ...baseRepository,
          id: '4',
          name: 'design-system',
          displayName: 'Design System',
          description: 'Shared UI components and design tokens',
          isPublic: true,
          permissionType: 'public',
          role: null,
        }}
      />
    </div>
  ),
};
