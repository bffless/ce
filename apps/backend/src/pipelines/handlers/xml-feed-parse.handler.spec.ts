import { XmlFeedParseHandler, XmlFeedParseOutput } from './xml-feed-parse.handler';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { FeedParserService, ParsedFeed } from '../feed-parser.service';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';

/** Build a ParsedFeed with `n` trivial entries for a given source. */
function fakeFeed(source: string, n: number): ParsedFeed {
  return {
    format: 'rss',
    title: source,
    entries: Array.from({ length: n }, (_, i) => ({
      source,
      guid: `${source}#${i}`,
      title: `entry ${i}`,
      enclosures: [],
      extensions: {},
    })),
  };
}

function buildHandler() {
  const registry = { register: jest.fn() };
  // The evaluator just returns the raw expression value in these tests — config
  // carries literal URLs / XML rather than real expressions.
  const expressionEvaluator = {
    evaluateExpression: jest.fn((expr: unknown) => expr),
  } as unknown as ExpressionEvaluator;
  const feedParser = { parse: jest.fn() } as unknown as jest.Mocked<
    Pick<FeedParserService, 'parse'>
  >;

  const handler = new XmlFeedParseHandler(
    registry as any,
    expressionEvaluator,
    feedParser as unknown as FeedParserService,
  );
  return { handler, feedParser, registry };
}

const context = {} as PipelineContext;
const step = (config: unknown): PipelineStep =>
  ({ name: 'feeds', handlerType: 'xml_feed_parse', config }) as unknown as PipelineStep;

describe('XmlFeedParseHandler', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('validateConfig', () => {
    it('requires exactly one of urls or xml', () => {
      const { handler } = buildHandler();
      expect(() => handler.validateConfig({})).toThrow(ConfigurationError);
      expect(() => handler.validateConfig({ urls: 'steps.x.urls', xml: 'steps.x.body' })).toThrow(
        ConfigurationError,
      );
      expect(() => handler.validateConfig({ urls: 'steps.x.urls' })).not.toThrow();
    });

    it('rejects out-of-range concurrency and timeout', () => {
      const { handler } = buildHandler();
      expect(() => handler.validateConfig({ urls: 'u', concurrency: 0 })).toThrow(
        ConfigurationError,
      );
      expect(() => handler.validateConfig({ urls: 'u', concurrency: 999 })).toThrow(
        ConfigurationError,
      );
      expect(() => handler.validateConfig({ urls: 'u', timeoutMs: 10 })).toThrow(
        ConfigurationError,
      );
    });
  });

  describe('URL mode', () => {
    it('fetches every URL and flattens entries across sources', async () => {
      const { handler, feedParser } = buildHandler();
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '<rss/>',
      } as Response);
      feedParser.parse.mockImplementation((_xml, source) => fakeFeed(source as string, 2));

      const result = await handler.execute(
        context,
        step({ urls: ['https://a.com/feed', 'https://b.com/feed'] }),
      );

      const output = result.output as XmlFeedParseOutput;
      expect(result.success).toBe(true);
      expect(output.okCount).toBe(2);
      expect(output.errorCount).toBe(0);
      expect(output.totalEntries).toBe(4);
      expect(output.entries).toHaveLength(4);
      expect(output.sources).toEqual([
        { source: 'https://a.com/feed', ok: true, count: 2 },
        { source: 'https://b.com/feed', ok: true, count: 2 },
      ]);
    });

    it('records a per-source error without sinking the batch', async () => {
      const { handler, feedParser } = buildHandler();
      jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
        if (String(input).includes('bad')) {
          throw new Error('ECONNREFUSED');
        }
        return { ok: true, status: 200, statusText: 'OK', text: async () => '<rss/>' } as Response;
      });
      feedParser.parse.mockImplementation((_xml, source) => fakeFeed(source as string, 3));

      const result = await handler.execute(
        context,
        step({ urls: ['https://good.com/feed', 'https://bad.com/feed'] }),
      );

      const output = result.output as XmlFeedParseOutput;
      expect(result.success).toBe(true); // batch survives
      expect(output.okCount).toBe(1);
      expect(output.errorCount).toBe(1);
      expect(output.totalEntries).toBe(3);
      const bad = output.sources.find((s) => s.source.includes('bad'));
      expect(bad).toMatchObject({ ok: false, count: 0 });
      expect(bad?.error).toContain('ECONNREFUSED');
    });

    it('treats a non-2xx response as a per-source error', async () => {
      const { handler, feedParser } = buildHandler();
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => '',
      } as Response);

      const result = await handler.execute(context, step({ urls: 'https://missing.com/feed' }));

      const output = result.output as XmlFeedParseOutput;
      expect(output.errorCount).toBe(1);
      expect(output.sources[0].error).toContain('404');
      expect(feedParser.parse).not.toHaveBeenCalled();
    });

    it('captures a fetch timeout as a per-source error', async () => {
      const { handler } = buildHandler();
      jest.spyOn(global, 'fetch').mockImplementation(async () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      });

      const result = await handler.execute(
        context,
        step({ urls: 'https://slow.com/feed', timeoutMs: 1000 }),
      );

      const output = result.output as XmlFeedParseOutput;
      expect(output.errorCount).toBe(1);
      expect(output.sources[0].error).toMatch(/Timed out/);
    });

    it('returns an empty result for an empty URL array', async () => {
      const { handler } = buildHandler();
      const fetchSpy = jest.spyOn(global, 'fetch');

      const result = await handler.execute(context, step({ urls: [] }));

      const output = result.output as XmlFeedParseOutput;
      expect(output).toEqual({
        entries: [],
        sources: [],
        totalEntries: 0,
        okCount: 0,
        errorCount: 0,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('raw XML mode', () => {
    it('parses an inline XML body without fetching', async () => {
      const { handler, feedParser } = buildHandler();
      const fetchSpy = jest.spyOn(global, 'fetch');
      feedParser.parse.mockReturnValue(fakeFeed('inline-xml', 1));

      const result = await handler.execute(context, step({ xml: '<rss>...</rss>' }));

      const output = result.output as XmlFeedParseOutput;
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(output.totalEntries).toBe(1);
      expect(output.sources[0]).toMatchObject({ source: 'inline-xml', ok: true, count: 1 });
    });

    it('reports a malformed inline body as an error outcome, not a throw', async () => {
      const { handler, feedParser } = buildHandler();
      feedParser.parse.mockImplementation(() => {
        throw new Error('Malformed XML: something');
      });

      const result = await handler.execute(context, step({ xml: 'not-xml' }));

      const output = result.output as XmlFeedParseOutput;
      expect(result.success).toBe(true);
      expect(output.errorCount).toBe(1);
      expect(output.sources[0].error).toContain('Malformed XML');
    });
  });
});
