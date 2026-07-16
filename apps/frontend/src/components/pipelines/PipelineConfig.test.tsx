import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PipelineConfig, type PipelineConfigData } from './PipelineConfig';

vi.mock('@/services/setupApi', () => ({
  useGetCurrentStorageConfigQuery: () => ({ data: { storageProvider: 's3' } }),
}));

vi.mock('@/services/projectsApi', () => ({
  useGetProjectSecretsQuery: () => ({ data: { secrets: [] } }),
}));

/**
 * Steps as authored outside the admin UI (CLI `rules push`, imported JSON):
 * `id` is optional on the wire and these carry none. The UI used to key all
 * per-step state by `step.id`, so every id-less step collapsed onto the same
 * `undefined` key — expanding one expanded all, and editing one edited all.
 */
const idLessConfig = (): Partial<PipelineConfigData> => ({
  name: 'landing-episodes',
  steps: [
    { name: 'fetch_playlist', handlerType: 'http_request', config: { url: 'https://example.com' } },
    { name: 'shape', handlerType: 'function_handler', config: { code: 'return 1;' } },
  ],
});

/** The card header button that toggles a step open. Anchored so it doesn't also
 *  match the "Delete <name>" / "Move <name> up" controls in the same header. */
const header = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

/** A step is expanded iff its body — the Step Name field — is mounted. */
const isExpanded = (name: string) => screen.queryByDisplayValue(name) !== null;

/**
 * Steps from the most recent onChange. Expanding a step mounts its handler
 * config, which normalizes and emits its own onChange, so assert on the last
 * call rather than counting calls.
 */
const lastSteps = (onChange: ReturnType<typeof vi.fn>) =>
  onChange.mock.calls.at(-1)![0].steps as PipelineConfigData['steps'];

/** Mirrors how the real parent owns `config` and feeds edits back down. */
function ControlledHarness({ onChange }: { onChange?: (c: PipelineConfigData) => void }) {
  const [config, setConfig] = useState<Partial<PipelineConfigData>>(idLessConfig);
  return (
    <PipelineConfig
      config={config}
      onChange={(next) => {
        setConfig(next);
        onChange?.(next);
      }}
      projectId="p1"
    />
  );
}

describe('PipelineConfig with id-less steps', () => {
  it('expands only the clicked step', () => {
    render(<PipelineConfig config={idLessConfig()} onChange={vi.fn()} projectId="p1" />);

    expect(isExpanded('fetch_playlist')).toBe(false);
    expect(isExpanded('shape')).toBe(false);

    fireEvent.click(header('fetch_playlist'));

    expect(isExpanded('fetch_playlist')).toBe(true);
    expect(isExpanded('shape')).toBe(false);
  });

  it('renames only the edited step', () => {
    const onChange = vi.fn();
    render(<PipelineConfig config={idLessConfig()} onChange={onChange} projectId="p1" />);

    fireEvent.click(header('fetch_playlist'));
    fireEvent.change(screen.getByDisplayValue('fetch_playlist'), {
      target: { value: 'fetch_playlist_v2' },
    });

    expect(lastSteps(onChange)).toEqual([
      expect.objectContaining({ name: 'fetch_playlist_v2' }),
      expect.objectContaining({ name: 'shape' }),
    ]);
  });

  it('deletes only the confirmed step', () => {
    const onChange = vi.fn();
    render(<PipelineConfig config={idLessConfig()} onChange={onChange} projectId="p1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete fetch_playlist' }));
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));

    expect(lastSteps(onChange)).toEqual([expect.objectContaining({ name: 'shape' })]);
  });

  it('disables only the toggled step', () => {
    const onChange = vi.fn();
    render(<PipelineConfig config={idLessConfig()} onChange={onChange} projectId="p1" />);

    fireEvent.click(screen.getAllByRole('switch')[0]);

    expect(lastSteps(onChange)).toEqual([
      expect.objectContaining({ name: 'fetch_playlist', isEnabled: false }),
      expect.objectContaining({ name: 'shape' }),
    ]);
    expect(lastSteps(onChange)[1].isEnabled).toBeUndefined();
  });

  it('keeps expansion with its step across a move', () => {
    render(<ControlledHarness />);

    fireEvent.click(header('shape'));
    expect(isExpanded('shape')).toBe(true);
    expect(isExpanded('fetch_playlist')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Move shape up' }));

    // `shape` is now first; expansion should have travelled with it.
    expect(isExpanded('shape')).toBe(true);
    expect(isExpanded('fetch_playlist')).toBe(false);
  });

  it('does not write a synthetic id back to the wire format', () => {
    const onChange = vi.fn();
    render(<PipelineConfig config={idLessConfig()} onChange={onChange} projectId="p1" />);

    fireEvent.click(header('fetch_playlist'));
    fireEvent.change(screen.getByDisplayValue('fetch_playlist'), {
      target: { value: 'renamed' },
    });

    // A minted id would surface as drift on the next `rules diff` / `rules pull`.
    for (const step of lastSteps(onChange)) {
      expect(step).not.toHaveProperty('id');
    }
  });
});
