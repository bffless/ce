import type { Meta, StoryObj } from '@storybook/react';
import { CommitGraphRow, ROW_HEIGHT } from './CommitGraphRow';
import type { CommitNode } from './types';

const mockCommit: CommitNode = {
  sha: 'abc123def456789012345678901234567890abcd',
  shortSha: 'abc123d',
  branch: 'main',
  description: 'Frontend build for release v0.0.46',
  deployedAt: new Date(Date.now() - 1000 * 60 * 60 * 13).toISOString(), // 13 hours ago
};

const meta: Meta<typeof CommitGraphRow> = {
  title: 'Repo/RefSelector/CommitGraphRow',
  component: CommitGraphRow,
  decorators: [
    (Story) => (
      <div style={{ width: 700, height: ROW_HEIGHT }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    onSelect: { action: 'selected' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    style: { position: 'relative', height: ROW_HEIGHT, width: '100%' },
    commit: mockCommit,
    isSelected: false,
  },
};

export const Selected: Story = {
  args: {
    style: { position: 'relative', height: ROW_HEIGHT, width: '100%' },
    commit: mockCommit,
    isSelected: true,
  },
};

export const WithAlias: Story = {
  args: {
    style: { position: 'relative', height: ROW_HEIGHT, width: '100%' },
    commit: mockCommit,
    isSelected: false,
    aliasName: 'production',
  },
};

export const WithAliasSelected: Story = {
  args: {
    style: { position: 'relative', height: ROW_HEIGHT, width: '100%' },
    commit: mockCommit,
    isSelected: true,
    aliasName: 'staging',
  },
};

export const FeatureBranch: Story = {
  args: {
    style: { position: 'relative', height: ROW_HEIGHT, width: '100%' },
    commit: {
      ...mockCommit,
      branch: 'feat/storage-settings',
      description: 'Frontend build preview for PR #188 (feat/storage-settings)',
    },
    isSelected: false,
  },
};

export const BugfixBranch: Story = {
  args: {
    style: { position: 'relative', height: ROW_HEIGHT, width: '100%' },
    commit: {
      ...mockCommit,
      branch: 'bug/remove-auto',
      description: 'Frontend build preview for PR #186 (bug/remove-auto)',
    },
    isSelected: false,
  },
};

export const LongBranchName: Story = {
  args: {
    style: { position: 'relative', height: ROW_HEIGHT, width: '100%' },
    commit: {
      ...mockCommit,
      branch: 'feat/very-long-branch-name-that-should-be-truncated',
      description: 'Frontend build with very long branch name',
    },
    isSelected: false,
  },
};

export const NoMessage: Story = {
  args: {
    style: { position: 'relative', height: ROW_HEIGHT, width: '100%' },
    commit: {
      ...mockCommit,
      description: null,
    },
    isSelected: false,
  },
};

export const CommitList: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 700, background: 'var(--background)' }}>
        <Story />
      </div>
    ),
  ],
  render: () => {
    const commits: Array<{ commit: CommitNode; aliasName?: string }> = [
      {
        commit: {
          sha: 'c7e5c78abc123456789012345678901234567890',
          shortSha: 'c7e5c78',
          branch: 'feat/storage-settings',
          description: 'Frontend build preview for PR #188 (feat/storage-settings)',
          deployedAt: new Date(Date.now() - 1000 * 60 * 3).toISOString(),
        },
      },
      {
        commit: {
          sha: 'dd22cdbdef456789012345678901234567890abc',
          shortSha: 'dd22cdb',
          branch: 'main',
          description: 'Frontend build for release v0.0.46',
          deployedAt: new Date(Date.now() - 1000 * 60 * 60 * 13).toISOString(),
        },
        aliasName: 'production',
      },
      {
        commit: {
          sha: '09e5526ghi789012345678901234567890abcdef',
          shortSha: '09e5526',
          branch: 'feat/www-enabled',
          description: 'Frontend build preview for PR #187 (feat/www-enabled)',
          deployedAt: new Date(Date.now() - 1000 * 60 * 60 * 13).toISOString(),
        },
        aliasName: 'staging',
      },
      {
        commit: {
          sha: '8827f1bjkl012345678901234567890abcdefghi',
          shortSha: '8827f1b',
          branch: 'main',
          description: 'Frontend build for release v0.0.45',
          deployedAt: new Date(Date.now() - 1000 * 60 * 60 * 15).toISOString(),
        },
      },
      {
        commit: {
          sha: '706b52dmno345678901234567890abcdefghijkl',
          shortSha: '706b52d',
          branch: 'bug/remove-auto',
          description: 'Frontend build preview for PR #186 (bug/remove-auto)',
          deployedAt: new Date(Date.now() - 1000 * 60 * 60 * 15).toISOString(),
        },
      },
    ];

    return (
      <div>
        {commits.map(({ commit, aliasName }, index) => (
          <CommitGraphRow
            key={commit.sha}
            style={{ position: 'relative', height: ROW_HEIGHT, width: '100%' }}
            commit={commit}
            isSelected={index === 2}
            onSelect={() => {}}
            aliasName={aliasName}
          />
        ))}
      </div>
    );
  },
};
