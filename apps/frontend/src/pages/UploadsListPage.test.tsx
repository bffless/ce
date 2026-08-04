import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { UploadsListPage } from './UploadsListPage';
import type { PipelineSchemaWithCount } from '@/services/pipelineSchemasApi';

const dataQueryArgs = vi.fn();
let schemas: PipelineSchemaWithCount[];
let fileTotals: Record<string, number | undefined>;

vi.mock('@/services/pipelineSchemasApi', () => ({
  useGetProjectSchemasQuery: () => ({ data: { schemas }, isLoading: false, error: undefined }),
  useGetSchemaDataQuery: (args: { schemaId: string }) => {
    dataQueryArgs(args);
    const total = fileTotals[args.schemaId];
    return { data: total === undefined ? undefined : { records: [], total }, isLoading: false };
  },
  // Rendered by the page's "Generate Upload Schema" modal, unused by these specs.
  useGenerateUploadSchemaMutation: () => [vi.fn(), { isLoading: false }],
}));

vi.mock('@/services/proxyRulesApi', () => ({
  useGetProjectRuleSetsQuery: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/services/projectsApi', () => ({
  useGetProjectQuery: () => ({ data: { id: 'proj-1' }, isLoading: false }),
}));

vi.mock('@/hooks/useProjectRole', () => ({
  useProjectRole: () => ({ canEdit: true }),
}));

function uploadSchema(name: string, recordCount: number): PipelineSchemaWithCount {
  return {
    id: `${name}-id`,
    name,
    projectId: 'proj-1',
    recordCount,
    fields: ['storage_path', 'content_type', 'url'].map((f) => ({
      name: f,
      type: 'string',
      required: true,
    })),
  } as unknown as PipelineSchemaWithCount;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/repo/bffless/handoff/uploads']}>
      <Routes>
        <Route path="/repo/:owner/:repo/uploads" element={<UploadsListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  dataQueryArgs.mockClear();
  schemas = [uploadSchema('handoff_nodes', 3)];
  fileTotals = { 'handoff_nodes-id': 1 };
});

describe('UploadsListPage schema cards', () => {
  it('counts files with the same filter the detail view uses', () => {
    renderPage();
    expect(dataQueryArgs).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaId: 'handoff_nodes-id',
        filters: { storage_path: { op: 'exists', value: 'true' } },
      }),
    );
  });

  it('shows the file count, not the row count, and accounts for the difference', () => {
    renderPage();
    // 3 rows in the schema, 1 of them a file → 2 folder/metadata rows
    expect(screen.getByText('1 file · 2 non-file records')).toBeInTheDocument();
    expect(screen.queryByText(/3 records/)).not.toBeInTheDocument();
  });

  it('says nothing about non-file records when every row is a file', () => {
    schemas = [uploadSchema('product_images', 4)];
    fileTotals = { 'product_images-id': 4 };
    renderPage();
    expect(screen.getByText('4 files')).toBeInTheDocument();
  });

  it('keeps a declared non-upload schema out of the Upload Schemas section (ce#633)', () => {
    // Field shape alone would have listed this as an upload schema.
    schemas = [{ ...uploadSchema('chat_messages', 2), kind: 'chat' } as PipelineSchemaWithCount];
    renderPage();
    expect(screen.queryByText('Upload Schemas')).not.toBeInTheDocument();
    expect(screen.getByText('All Schemas')).toBeInTheDocument();
  });

  it('shows a placeholder rather than a wrong count while the total loads', () => {
    fileTotals = {};
    renderPage();
    // The row count would be a lie for a mixed schema, so it is never shown —
    // not even as a stand-in that would then flicker to the real number.
    expect(screen.queryByText(/\d+ (file|record)/)).not.toBeInTheDocument();
  });
});
