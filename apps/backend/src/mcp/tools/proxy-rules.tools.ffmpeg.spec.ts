import { pipelineStepSchema } from './proxy-rules.tools';

describe('MCP pipelineStepSchema accepts ffmpeg_handler', () => {
  it('parses an ffmpeg_handler step', () => {
    const step = {
      id: '1',
      name: 'slice',
      handlerType: 'ffmpeg_handler',
      config: {
        operation: 'slice',
        input: 'a.mp4',
        spans: [{ start: 0, end: 2 }],
        output: 'b.mp4',
      },
    };
    expect(() => pipelineStepSchema.parse(step)).not.toThrow();
  });
});
