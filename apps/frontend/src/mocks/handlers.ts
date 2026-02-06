import { http, HttpResponse } from 'msw';
import type { GetMyRepositoriesResponse, GetRepositoryFeedResponse } from '@/services/repositoriesApi';

// Mock data generators
export const mockRepositories = {
  sidebar: (): GetMyRepositoriesResponse => ({
    total: 3,
    repositories: [
      { id: '1', owner: 'acme', name: 'webapp', permissionType: 'owner', role: 'admin' },
      { id: '2', owner: 'acme', name: 'docs', permissionType: 'direct', role: 'write' },
      { id: '3', owner: 'acme', name: 'api', permissionType: 'group', role: 'read' },
    ],
  }),

  feed: (): GetRepositoryFeedResponse => ({
    page: 1,
    limit: 10,
    total: 3,
    repositories: [
      {
        id: '1',
        owner: 'acme',
        name: 'webapp',
        displayName: 'Web Application',
        description: 'Main web application frontend',
        isPublic: false,
        permissionType: 'owner',
        role: 'admin',
        stats: {
          deploymentCount: 42,
          storageBytes: 1024 * 1024 * 50,
          storageMB: 50,
          lastDeployedAt: new Date().toISOString(),
        },
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: new Date().toISOString(),
      },
      {
        id: '2',
        owner: 'acme',
        name: 'docs',
        displayName: 'Documentation',
        description: 'API documentation and guides',
        isPublic: true,
        permissionType: 'direct',
        role: 'write',
        stats: {
          deploymentCount: 15,
          storageBytes: 1024 * 1024 * 10,
          storageMB: 10,
          lastDeployedAt: '2024-12-01T14:30:00Z',
        },
        createdAt: '2024-02-20T08:00:00Z',
        updatedAt: '2024-12-01T14:30:00Z',
      },
      {
        id: '3',
        owner: 'acme',
        name: 'api',
        displayName: null,
        description: null,
        isPublic: false,
        permissionType: 'group',
        role: 'read',
        stats: {
          deploymentCount: 8,
          storageBytes: 1024 * 1024 * 5,
          storageMB: 5,
          lastDeployedAt: '2024-11-15T09:00:00Z',
        },
        createdAt: '2024-03-10T12:00:00Z',
        updatedAt: '2024-11-15T09:00:00Z',
      },
    ],
  }),
};

export const mockUser = {
  current: () => ({
    id: 'user-1',
    email: 'demo@example.com',
    name: 'Demo User',
    role: 'admin',
  }),
};

// Default handlers - can be overridden per-story
export const handlers = [
  // Repositories
  http.get('/api/repositories/mine', () => {
    return HttpResponse.json(mockRepositories.sidebar());
  }),

  http.get('/api/repositories/feed', () => {
    return HttpResponse.json(mockRepositories.feed());
  }),

  // Auth / User
  http.get('/api/auth/me', () => {
    return HttpResponse.json(mockUser.current());
  }),

  // Setup status (assume setup is complete)
  http.get('/api/setup/status', () => {
    return HttpResponse.json({ isComplete: true });
  }),

  // Feature flags (return empty by default)
  http.get('/api/feature-flags', () => {
    return HttpResponse.json({ flags: {} });
  }),
];
