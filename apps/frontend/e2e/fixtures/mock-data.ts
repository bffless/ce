/**
 * Mock data fixtures for E2E tests
 */

export const mockRepoStats = {
  repository: 'bffless/ce',
  totalDeployments: 51,
  totalStorageBytes: 58314752,
  totalStorageMB: 55.6,
  lastDeployedAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
  branchCount: 10,
  aliasCount: 1,
  isPublic: true,
};

export const mockDeployments = {
  repository: 'bffless/ce',
  page: 1,
  limit: 20,
  total: 51,
  deployments: [
    {
      id: 'deploy-1',
      commitSha: 'abc123def456789',
      shortSha: 'abc123d',
      branch: 'main',
      workflowName: 'Deploy to Production',
      deployedAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
      fileCount: 42,
      totalSize: 1234567,
      isPublic: true,
    },
    {
      id: 'deploy-2',
      commitSha: 'def456ghi789012',
      shortSha: 'def456g',
      branch: 'main',
      workflowName: 'Deploy to Production',
      deployedAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
      fileCount: 40,
      totalSize: 1198765,
      isPublic: true,
    },
    {
      id: 'deploy-3',
      commitSha: 'ghi789jkl012345',
      shortSha: 'ghi789j',
      branch: 'develop',
      workflowName: 'Deploy to Staging',
      deployedAt: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
      fileCount: 38,
      totalSize: 1156789,
      isPublic: true,
    },
    {
      id: 'deploy-4',
      commitSha: 'jkl012mno345678',
      shortSha: 'jkl012m',
      branch: 'main',
      workflowName: 'Deploy to Production',
      deployedAt: new Date(Date.now() - 259200000).toISOString(), // 3 days ago
      fileCount: 41,
      totalSize: 1223456,
      isPublic: true,
    },
    {
      id: 'deploy-5',
      commitSha: 'mno345pqr678901',
      shortSha: 'mno345p',
      branch: 'feature/new-ui',
      workflowName: 'Deploy to Preview',
      deployedAt: new Date(Date.now() - 345600000).toISOString(), // 4 days ago
      fileCount: 43,
      totalSize: 1267890,
      isPublic: true,
    },
  ],
};

export const mockRepoRefs = {
  aliases: [
    {
      name: 'production',
      commitSha: 'abc123def456',
      updatedAt: '2025-01-15T10:00:00Z',
    },
    {
      name: 'staging',
      commitSha: 'def456ghi789',
      updatedAt: '2025-01-14T15:30:00Z',
    },
  ],
  branches: [
    {
      name: 'main',
      latestCommit: 'abc123def456',
      latestDeployedAt: '2025-01-15T10:00:00Z',
      fileCount: 25,
    },
    {
      name: 'develop',
      latestCommit: 'def456ghi789',
      latestDeployedAt: '2025-01-14T15:30:00Z',
      fileCount: 23,
    },
  ],
  recentCommits: [
    {
      sha: 'abc123def456',
      shortSha: 'abc123d',
      branch: 'main',
      description: 'Deploy Production',
      deployedAt: '2025-01-15T10:00:00Z',
      parentShas: [],
    },
    {
      sha: 'def456ghi789',
      shortSha: 'def456g',
      branch: 'develop',
      description: 'Deploy Staging',
      deployedAt: '2025-01-14T15:30:00Z',
      parentShas: ['abc123def456'],
    },
  ],
  pagination: {
    hasMore: false,
    total: 2,
  },
};

export const mockFileTree = {
  commitSha: 'abc123def456',
  repository: 'test-repo',
  branch: 'main',
  files: [
    {
      path: 'README.md',
      fileName: 'README.md',
      size: 1024,
      mimeType: 'text/markdown',
      isPublic: true,
      createdAt: '2025-01-10T09:00:00Z',
    },
    {
      path: 'index.html',
      fileName: 'index.html',
      size: 2048,
      mimeType: 'text/html',
      isPublic: true,
      createdAt: '2025-01-10T09:00:00Z',
    },
    {
      path: 'styles.css',
      fileName: 'styles.css',
      size: 512,
      mimeType: 'text/css',
      isPublic: true,
      createdAt: '2025-01-10T09:00:00Z',
    },
    {
      path: 'src/index.js',
      fileName: 'index.js',
      size: 3072,
      mimeType: 'application/javascript',
      isPublic: true,
      createdAt: '2025-01-10T09:00:00Z',
    },
    {
      path: 'src/app.ts',
      fileName: 'app.ts',
      size: 4096,
      mimeType: 'application/typescript',
      isPublic: true,
      createdAt: '2025-01-10T09:00:00Z',
    },
    {
      path: 'src/components/Button.tsx',
      fileName: 'Button.tsx',
      size: 1536,
      mimeType: 'application/typescript',
      isPublic: true,
      createdAt: '2025-01-10T09:00:00Z',
    },
    {
      path: 'src/utils/helpers.js',
      fileName: 'helpers.js',
      size: 2560,
      mimeType: 'application/javascript',
      isPublic: true,
      createdAt: '2025-01-10T09:00:00Z',
    },
    {
      path: 'assets/logo.png',
      fileName: 'logo.png',
      size: 8192,
      mimeType: 'image/png',
      isPublic: true,
      createdAt: '2025-01-10T09:00:00Z',
    },
    {
      path: 'assets/banner.jpg',
      fileName: 'banner.jpg',
      size: 16384,
      mimeType: 'image/jpeg',
      isPublic: true,
      createdAt: '2025-01-10T09:00:00Z',
    },
    {
      path: 'docs/api.md',
      fileName: 'api.md',
      size: 4096,
      mimeType: 'text/markdown',
      isPublic: true,
      createdAt: '2025-01-10T09:00:00Z',
    },
    {
      path: 'package.json',
      fileName: 'package.json',
      size: 768,
      mimeType: 'application/json',
      isPublic: true,
      createdAt: '2025-01-10T09:00:00Z',
    },
  ],
};

export const mockFileContents: Record<string, string> = {
  'README.md': `# Test Repository

This is a test repository for E2E testing.

## Features

- Feature 1
- Feature 2
- Feature 3

## Installation

\`\`\`bash
npm install
\`\`\`

## Usage

\`\`\`bash
npm start
\`\`\`
`,
  'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Page</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <h1>Hello, World!</h1>
  <p>This is a test HTML file.</p>
  <script src="src/index.js"></script>
</body>
</html>
`,
  'styles.css': `body {
  font-family: Arial, sans-serif;
  margin: 0;
  padding: 20px;
  background-color: #f5f5f5;
}

h1 {
  color: #333;
  font-size: 2rem;
}

p {
  color: #666;
  line-height: 1.6;
}
`,
  'src/index.js': `import { App } from './app';

console.log('Starting application...');

const app = new App();
app.init();

export default app;
`,
  'src/app.ts': `export class App {
  private name: string;

  constructor() {
    this.name = 'Test App';
  }

  init(): void {
    console.log(\`Initializing \${this.name}\`);
    this.render();
  }

  render(): void {
    console.log('Rendering...');
  }
}
`,
  'src/components/Button.tsx': `import React from 'react';

interface ButtonProps {
  label: string;
  onClick: () => void;
}

export const Button: React.FC<ButtonProps> = ({ label, onClick }) => {
  return (
    <button onClick={onClick} className="btn">
      {label}
    </button>
  );
};
`,
  'src/utils/helpers.js': `export function formatDate(date) {
  return new Date(date).toLocaleDateString();
}

export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
`,
  'docs/api.md': `# API Documentation

## Endpoints

### GET /api/data

Returns a list of data items.

**Response:**
\`\`\`json
{
  "data": []
}
\`\`\`

### POST /api/data

Creates a new data item.

**Request:**
\`\`\`json
{
  "name": "string"
}
\`\`\`
`,
  'package.json': `{
  "name": "test-repo",
  "version": "1.0.0",
  "description": "Test repository",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "test": "jest"
  },
  "dependencies": {
    "react": "^18.0.0"
  }
}
`,
};

// Mock repositories for sidebar and feed
export const mockSidebarRepositories = {
  total: 5,
  repositories: [
    {
      id: 'repo-1',
      owner: 'bffless',
      name: 'ce',
      permissionType: 'owner' as const,
      role: 'owner',
    },
    {
      id: 'repo-2',
      owner: 'bffless',
      name: 'timechain-explorer',
      permissionType: 'owner' as const,
      role: 'owner',
    },
    {
      id: 'repo-3',
      owner: 'acme-corp',
      name: 'shared-docs',
      permissionType: 'direct' as const,
      role: 'admin',
    },
    {
      id: 'repo-4',
      owner: 'team',
      name: 'project-alpha',
      permissionType: 'group' as const,
      role: 'contributor',
    },
    {
      id: 'repo-5',
      owner: 'openjs',
      name: 'public-examples',
      permissionType: 'owner' as const,
      role: 'owner',
    },
  ],
};

export const mockRepositoryFeed = {
  page: 1,
  limit: 20,
  total: 5,
  repositories: [
    {
      id: 'repo-1',
      owner: 'bffless',
      name: 'ce',
      displayName: 'WSA Open Source',
      description: 'Self-hosted static asset hosting platform',
      isPublic: true,
      permissionType: 'owner' as const,
      role: 'owner',
      stats: {
        deploymentCount: 51,
        storageBytes: 58314752,
        storageMB: 55.6,
        lastDeployedAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
      },
      createdAt: new Date(Date.now() - 86400000 * 30).toISOString(), // 30 days ago
      updatedAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
    },
    {
      id: 'repo-2',
      owner: 'bffless',
      name: 'timechain-explorer',
      displayName: 'Timechain Explorer',
      description: 'Bitcoin blockchain explorer',
      isPublic: false,
      permissionType: 'owner' as const,
      role: 'owner',
      stats: {
        deploymentCount: 23,
        storageBytes: 31457280,
        storageMB: 30.0,
        lastDeployedAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
      },
      createdAt: new Date(Date.now() - 86400000 * 60).toISOString(), // 60 days ago
      updatedAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    },
    {
      id: 'repo-3',
      owner: 'acme-corp',
      name: 'shared-docs',
      displayName: 'Shared Documentation',
      description: 'Team documentation and knowledge base',
      isPublic: false,
      permissionType: 'direct' as const,
      role: 'admin',
      stats: {
        deploymentCount: 15,
        storageBytes: 10485760,
        storageMB: 10.0,
        lastDeployedAt: new Date(Date.now() - 86400000 * 2).toISOString(), // 2 days ago
      },
      createdAt: new Date(Date.now() - 86400000 * 90).toISOString(), // 90 days ago
      updatedAt: new Date(Date.now() - 86400000 * 2).toISOString(), // 2 days ago
    },
    {
      id: 'repo-4',
      owner: 'team',
      name: 'project-alpha',
      displayName: 'Project Alpha',
      description: 'Internal project for team collaboration',
      isPublic: false,
      permissionType: 'group' as const,
      role: 'contributor',
      stats: {
        deploymentCount: 8,
        storageBytes: 5242880,
        storageMB: 5.0,
        lastDeployedAt: new Date(Date.now() - 86400000 * 7).toISOString(), // 7 days ago
      },
      createdAt: new Date(Date.now() - 86400000 * 45).toISOString(), // 45 days ago
      updatedAt: new Date(Date.now() - 86400000 * 7).toISOString(), // 7 days ago
    },
    {
      id: 'repo-5',
      owner: 'openjs',
      name: 'public-examples',
      displayName: 'Public Examples',
      description: 'Example projects and demos',
      isPublic: true,
      permissionType: 'owner' as const,
      role: 'owner',
      stats: {
        deploymentCount: 3,
        storageBytes: 2097152,
        storageMB: 2.0,
        lastDeployedAt: new Date(Date.now() - 86400000 * 14).toISOString(), // 14 days ago
      },
      createdAt: new Date(Date.now() - 86400000 * 20).toISOString(), // 20 days ago
      updatedAt: new Date(Date.now() - 86400000 * 14).toISOString(), // 14 days ago
    },
  ],
};

// Mock empty repository feed
export const mockEmptyRepositoryFeed = {
  page: 1,
  limit: 20,
  total: 0,
  repositories: [],
};
