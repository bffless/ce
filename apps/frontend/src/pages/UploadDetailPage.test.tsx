import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { UploadDetailPage } from './UploadDetailPage';
import type { PipelineSchemaWithCount } from '@/services/pipelineSchemasApi';

// Captures the args the page passes to the data query, so the test can assert
// on the filter it asks the API for (the fix for uploads listing folder rows).
const dataQueryArgs = vi.fn();
let schemaResult: { data?: PipelineSchemaWithCount; isLoading: boolean };
let dataResult: {
  data?: { records: unknown[]; total: number; page: number; pageSize: number; totalPages: number };
  isLoading: boolean;
};

vi.mock('@/services/pipelineSchemasApi', () => ({
  useGetSchemaQuery: () => schemaResult,
  useGetSchemaDataQuery: (args: unknown, options: unknown) => {
    dataQueryArgs(args, options);
    return dataResult;
  },
  useDeleteRecordMutation: () => [vi.fn(), { isLoading: false }],
}));

vi.mock('@/hooks/useProjectRole', () => ({
  useProjectRole: () => ({ canEdit: true }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function makeSchema(fieldNames: string[], recordCount: number): PipelineSchemaWithCount {
  return {
    id: 'schema-1',
    name: 'handoff_nodes',
    projectId: 'proj-1',
    fields: fieldNames.map((name) => ({ name, type: 'string', required: false })),
    recordCount,
  } as unknown as PipelineSchemaWithCount;
}

function fileRecord() {
  return {
    id: 'rec-1',
    createdAt: '2026-08-04T06:14:42.000Z',
    data: {
      original_name: 'shot.png',
      storage_path: 'bffless/handoff/uploads/content/uuid-shot.png',
      content_type: 'image/png',
      size: 232200,
      url: '/api/uploads/content/uuid-shot.png',
    },
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/repo/bffless/handoff/uploads/schema-1']}>
      <Routes>
        <Route path="/repo/:owner/:repo/uploads/:schemaId" element={<UploadDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  dataQueryArgs.mockClear();
  schemaResult = { data: makeSchema(['storage_path', 'content_type', 'url'], 3), isLoading: false };
  dataResult = {
    data: { records: [fileRecord()], total: 1, page: 1, pageSize: 20, totalPages: 1 },
    isLoading: false,
  };
});

describe('UploadDetailPage', () => {
  it('asks only for records that reference a stored file', () => {
    renderPage();
    expect(dataQueryArgs).toHaveBeenCalled();
    const [args] = dataQueryArgs.mock.calls[dataQueryArgs.mock.calls.length - 1];
    expect(args.filters).toEqual({ storage_path: { op: 'exists', value: 'true' } });
  });

  it('reports the records held back so they are not silently dropped', () => {
    renderPage();
    // schema has 3 records, 1 of which is a file → 2 folder/metadata rows
    expect(screen.getByText(/1 uploaded file/)).toBeInTheDocument();
    expect(screen.getByText(/2 records without a file \(not shown\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view in data/i })).toHaveAttribute(
      'href',
      '/repo/bffless/handoff/data/schema-1',
    );
  });

  it('does not mention held-back records when every row is a file', () => {
    schemaResult = { data: makeSchema(['storage_path', 'url'], 1), isLoading: false };
    renderPage();
    expect(screen.queryByText(/without a file/)).not.toBeInTheDocument();
  });

  it('sends no file filter for a schema that has no storage_path field', () => {
    schemaResult = { data: makeSchema(['name', 'body'], 2), isLoading: false };
    renderPage();
    const [args] = dataQueryArgs.mock.calls[dataQueryArgs.mock.calls.length - 1];
    expect(args.filters).toBeUndefined();
  });

  it('waits for the schema before querying records', () => {
    schemaResult = { data: undefined, isLoading: true };
    renderPage();
    const [, options] = dataQueryArgs.mock.calls[dataQueryArgs.mock.calls.length - 1];
    expect(options.skip).toBe(true);
  });
});
