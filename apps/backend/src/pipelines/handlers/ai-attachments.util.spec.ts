import { buildAttachmentParts, AIAttachmentConfig } from './ai-attachments.util';

describe('buildAttachmentParts', () => {
  const resolveWith = (values: Record<string, unknown>) => (expr: string) => values[expr];

  it('fans an array source out into one image part per URL', () => {
    const attachments: AIAttachmentConfig[] = [{ type: 'image', source: 'steps.collect.images' }];
    const parts = buildAttachmentParts(
      attachments,
      resolveWith({
        'steps.collect.images': ['https://x.test/a.png', 'https://x.test/b.png'],
      }),
    );

    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: 'image', image: new URL('https://x.test/a.png') });
    expect(parts[1]).toEqual({ type: 'image', image: new URL('https://x.test/b.png') });
  });

  it('treats a single string source as one image part', () => {
    const parts = buildAttachmentParts(
      [{ type: 'image', source: 'steps.sign0.url' }],
      resolveWith({ 'steps.sign0.url': 'https://x.test/a.png' }),
    );

    expect(parts).toEqual([{ type: 'image', image: new URL('https://x.test/a.png') }]);
  });

  it('skips null, undefined, empty-string, and non-string values silently', () => {
    const parts = buildAttachmentParts(
      [
        { type: 'image', source: 'steps.a.url' },
        { type: 'image', source: 'steps.b.url' },
        { type: 'image', source: 'steps.c.urls' },
      ],
      resolveWith({
        'steps.a.url': null,
        'steps.b.url': '',
        'steps.c.urls': ['https://x.test/ok.png', undefined, 42, '   '],
      }),
    );

    expect(parts).toEqual([{ type: 'image', image: new URL('https://x.test/ok.png') }]);
  });

  it('returns [] when every source resolves empty', () => {
    const parts = buildAttachmentParts(
      [{ type: 'image', source: 'steps.a.url' }],
      resolveWith({ 'steps.a.url': undefined }),
    );
    expect(parts).toEqual([]);
  });

  it('builds file parts with mediaType', () => {
    const parts = buildAttachmentParts(
      [{ type: 'file', source: 'steps.signAudio.url', mediaType: 'audio/mpeg' }],
      resolveWith({ 'steps.signAudio.url': 'https://x.test/scene.mp3' }),
    );

    expect(parts).toEqual([
      { type: 'file', data: new URL('https://x.test/scene.mp3'), mediaType: 'audio/mpeg' },
    ]);
  });

  it('throws a descriptive error for a value that is not a valid absolute URL', () => {
    expect(() =>
      buildAttachmentParts(
        [{ type: 'image', source: 'steps.a.url' }],
        resolveWith({ 'steps.a.url': 'not-a-url' }),
      ),
    ).toThrow(/steps\.a\.url.*not-a-url/);
  });
});
