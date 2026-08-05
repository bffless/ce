import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listSkillsQuery = vi.fn();
const setSkillsPath = vi.fn();
const setSkillsAlias = vi.fn();

vi.mock('@/services/projectsApi', () => ({
  useListProjectSkillsQuery: (args: unknown) => {
    listSkillsQuery(args);
    return { data: { skills: [{ name: 'image-prompts', description: 'thumbnails' }] }, isLoading: false };
  },
  useGetProjectSkillsPathQuery: () => ({ data: { skillsPath: '.bffless/skills' } }),
  useSetProjectSkillsPathMutation: () => [setSkillsPath, { isLoading: false }],
  useGetProjectByIdQuery: () => ({ data: { owner: 'bffless', name: 'studio' } }),
  useGetProjectSkillsAliasQuery: () => ({ data: { skillsAlias: null } }),
  useSetProjectSkillsAliasMutation: () => [setSkillsAlias],
}));

vi.mock('@/services/repoApi', () => ({
  useListAliasesQuery: () => ({ data: { aliases: [{ name: 'studio' }, { name: 'production' }] } }),
}));

const { SkillsConfig } = await import('./SkillsConfig');

describe('SkillsConfig — step-scoped source', () => {
  beforeEach(() => {
    listSkillsQuery.mockClear();
    setSkillsPath.mockClear();
    setSkillsAlias.mockClear();
  });

  it('edits the path into the step config rather than the project setting', async () => {
    const onChange = vi.fn();
    render(
      <SkillsConfig config={{ mode: 'selected', enabled: [] }} onChange={onChange} projectId="proj-1" />,
    );

    await userEvent.type(screen.getByPlaceholderText('.bffless/skills'), 'x');

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ path: 'x' }));
    // The old separate Save button wrote a project-wide setting that silently
    // reconfigured every other AI step in the project.
    expect(setSkillsPath).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it("lists skills from the step's own path and alias", () => {
    render(
      <SkillsConfig
        config={{ mode: 'selected', enabled: [], path: 'apps/studio/dist/bffless/skills', alias: 'studio' }}
        onChange={vi.fn()}
        projectId="proj-1"
      />,
    );

    expect(listSkillsQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-1',
        path: 'apps/studio/dist/bffless/skills',
        alias: 'studio',
      }),
    );
  });

  it('shows the project default as the placeholder when the step sets no path', () => {
    render(
      <SkillsConfig config={{ mode: 'selected', enabled: [] }} onChange={vi.fn()} projectId="proj-1" />,
    );

    expect(screen.getByPlaceholderText('.bffless/skills')).toHaveValue('');
  });
});
