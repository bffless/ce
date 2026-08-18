import { pipelineStepSchema } from './proxy-rules.tools';

describe('MCP pipelineStepSchema accepts remote_request', () => {
  it('parses a remote_request step', () => {
    const step = {
      id: '1',
      name: 'render',
      handlerType: 'remote_request',
      config: {
        connection: 'pdf-renderer',
        path: '/render',
        body: { html: 'steps.build.html' },
        timeoutSeconds: 600,
      },
    };
    expect(() => pipelineStepSchema.parse(step)).not.toThrow();
  });

  it('documents the handler and its fuse error in the config description', () => {
    const description = pipelineStepSchema.shape.config.description ?? '';
    expect(description).toContain('remote_request');
    expect(description).toContain('REMOTE_BUSY');
  });
});
