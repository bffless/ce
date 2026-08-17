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

  it('parses an ffmpeg_handler step that pins the executor', () => {
    const step = {
      id: '2',
      name: 'extract',
      handlerType: 'ffmpeg_handler',
      config: {
        operation: 'extract_audio',
        input: 'a.mp4',
        output: 'a.wav',
        executor: 'remote',
      },
    };
    expect(() => pipelineStepSchema.parse(step)).not.toThrow();
  });
});
