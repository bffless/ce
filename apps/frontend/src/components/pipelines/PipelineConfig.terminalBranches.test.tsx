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
 * The landing-episodes pattern: two conditional response handlers at the end
 * of the pipeline (503 when the fetch failed, 200 when it succeeded). Authored
 * via the CLI, so steps carry no `id`. The editor must round-trip both.
 */
const branchedConfig = (): Partial<PipelineConfigData> => ({
  name: 'landing_episodes',
  steps: [
    { name: 'fetch_playlist', handlerType: 'http_request', config: { url: 'https://example.com', failOnError: false } },
    { name: 'shape', handlerType: 'function_handler', config: { code: 'return 1;' } },
    {
      name: 'unavailable',
      handlerType: 'response_handler',
      config: {
        condition: '!steps.fetch_playlist.ok',
        status: 503,
        contentType: 'application/json',
        body: '{ "error": "playlist_unavailable" }',
        headers: { 'Cache-Control': 'public, max-age=60' },
      },
    },
    {
      name: 'respond',
      handlerType: 'response_handler',
      config: {
        condition: 'steps.fetch_playlist.ok',
        status: 200,
        contentType: 'application/json',
        body: '{{{steps.shape.episodes}}}',
        headers: { 'Cache-Control': 'public, max-age=3600' },
      },
    },
  ],
});

const header = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

const lastSteps = (onChange: ReturnType<typeof vi.fn>) =>
  onChange.mock.calls.at(-1)![0].steps as PipelineConfigData['steps'];

/** Mirrors how the real parent owns `config` and feeds edits back down. */
function ControlledHarness({
  onChange,
  initial = branchedConfig,
}: {
  onChange?: (c: PipelineConfigData) => void;
  initial?: () => Partial<PipelineConfigData>;
}) {
  const [config, setConfig] = useState<Partial<PipelineConfigData>>(initial);
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

describe('PipelineConfig terminal response branches', () => {
  it('renders every trailing response handler as a branch card', () => {
    render(<PipelineConfig config={branchedConfig()} onChange={vi.fn()} projectId="p1" />);

    expect(header('unavailable')).toBeInTheDocument();
    expect(header('respond')).toBeInTheDocument();
  });

  it('shows each branch condition in the collapsed header', () => {
    render(<PipelineConfig config={branchedConfig()} onChange={vi.fn()} projectId="p1" />);

    expect(screen.getByText(/!steps\.fetch_playlist\.ok/)).toBeInTheDocument();
    expect(screen.getByText(/^when steps\.fetch_playlist\.ok$/)).toBeInTheDocument();
  });

  it('emits both branches unchanged when the pipeline is renamed', () => {
    const onChange = vi.fn();
    render(<PipelineConfig config={branchedConfig()} onChange={onChange} projectId="p1" />);

    fireEvent.change(screen.getByLabelText('Pipeline Name'), {
      target: { value: 'landing_episodes_v2' },
    });

    const steps = lastSteps(onChange);
    expect(steps).toHaveLength(4);
    expect(steps[2]).toEqual(branchedConfig().steps![2]);
    expect(steps[3]).toEqual(branchedConfig().steps![3]);
  });

  it('preserves a branch condition when its response editor mounts and edits', () => {
    const onChange = vi.fn();
    render(<ControlledHarness onChange={onChange} />);

    // Expanding mounts ResponseHandlerConfig, whose mount-time onChange used to
    // replace the config wholesale and strip `condition`.
    fireEvent.click(header('unavailable'));

    let steps = lastSteps(onChange);
    expect(steps[2].config.condition).toBe('!steps.fetch_playlist.ok');
    expect(steps[3]).toEqual(branchedConfig().steps![3]);

    // A real edit must also keep the condition.
    fireEvent.change(screen.getByDisplayValue('{ "error": "playlist_unavailable" }'), {
      target: { value: '{ "error": "unavailable" }' },
    });

    steps = lastSteps(onChange);
    expect(steps[2].config.condition).toBe('!steps.fetch_playlist.ok');
    expect(steps[2].config.body).toBe('{ "error": "unavailable" }');
    expect(steps[3]).toEqual(branchedConfig().steps![3]);
  });

  it('adds a new response branch via Add Branch', () => {
    const onChange = vi.fn();
    render(<ControlledHarness onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /Add Branch/ }));

    const steps = lastSteps(onChange);
    expect(steps).toHaveLength(5);
    expect(steps[4].handlerType).toBe('response_handler');
  });

  it('deletes only the confirmed branch', () => {
    const onChange = vi.fn();
    render(<ControlledHarness onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete unavailable' }));
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));

    const steps = lastSteps(onChange);
    expect(steps).toHaveLength(3);
    expect(steps[2]).toEqual(branchedConfig().steps![3]);
  });

  it('reorders branches with the move buttons', () => {
    const onChange = vi.fn();
    render(<ControlledHarness onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Move respond up' }));

    const steps = lastSteps(onChange);
    expect(steps[2].name).toBe('respond');
    expect(steps[3].name).toBe('unavailable');
  });

  it('does not mint ids onto id-less branches on unrelated edits', () => {
    const onChange = vi.fn();
    render(<PipelineConfig config={branchedConfig()} onChange={onChange} projectId="p1" />);

    fireEvent.change(screen.getByLabelText('Pipeline Name'), {
      target: { value: 'renamed' },
    });

    for (const step of lastSteps(onChange)) {
      expect(step).not.toHaveProperty('id');
    }
  });

  it('keeps a non-trailing response handler in the regular steps list', () => {
    const onChange = vi.fn();
    const config: Partial<PipelineConfigData> = {
      name: 'early_responder',
      steps: [
        { name: 'maybe_reply', handlerType: 'response_handler', config: { status: 200, body: 'x' } },
        { name: 'log', handlerType: 'function_handler', config: { code: 'return 1;' } },
      ],
    };
    render(<PipelineConfig config={config} onChange={onChange} projectId="p1" />);

    // Both steps visible; renaming the pipeline round-trips both.
    expect(header('maybe_reply')).toBeInTheDocument();
    expect(header('log')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Pipeline Name'), {
      target: { value: 'renamed' },
    });

    const steps = lastSteps(onChange);
    expect(steps.map((s) => s.name)).toEqual(['maybe_reply', 'log']);
  });

  it('still clears a single terminal step via the type dropdown', () => {
    const onChange = vi.fn();
    const single: Partial<PipelineConfigData> = {
      name: 'single',
      steps: [
        { name: 'shape', handlerType: 'function_handler', config: { code: 'return 1;' } },
        { name: 'respond', handlerType: 'response_handler', config: { status: 200, body: 'ok' } },
      ],
    };
    render(<PipelineConfig config={single} onChange={onChange} projectId="p1" />);

    fireEvent.click(screen.getByRole('combobox', { name: /terminal step type/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Default Response' }));

    const steps = lastSteps(onChange);
    expect(steps.map((s) => s.name)).toEqual(['shape']);
  });
});
