import { Injectable, Logger } from '@nestjs/common';
import { StepHandler } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';
import { FeedParserService, FeedEntry } from '../feed-parser.service';

/**
 * Configuration for the xml_feed_parse handler.
 */
export interface XmlFeedParseHandlerConfig {
  /**
   * Feed URL(s) to fetch and parse. An expression that resolves to a single URL
   * string or an array of URL strings (e.g. "steps.feeds.urls"). Fetched with
   * bounded concurrency; each source is parsed independently.
   * Mutually exclusive with `xml`.
   */
  urls?: string;

  /**
   * Raw feed XML to parse instead of fetching. An expression that resolves to an
   * XML string (e.g. "steps.download.body"), for parsing a body a prior step
   * fetched or a user uploaded. Mutually exclusive with `urls`.
   */
  xml?: string;

  /**
   * Max feeds fetched concurrently.
   * @default 8
   */
  concurrency?: number;

  /**
   * Per-feed fetch timeout in milliseconds.
   * @default 30000
   */
  timeoutMs?: number;

  /**
   * Condition expression - if provided, step only runs if this evaluates to true
   */
  condition?: string;
}

/** Per-source outcome in the handler output. */
interface SourceResult {
  source: string;
  ok: boolean;
  count: number;
  error?: string;
}

/** Structured output of the xml_feed_parse handler. */
export interface XmlFeedParseOutput {
  /** All parsed entries flattened across every source (only from sources that parsed). */
  entries: FeedEntry[];
  /** One entry per source with its outcome — a bad source is `ok:false` with an error. */
  sources: SourceResult[];
  totalEntries: number;
  okCount: number;
  errorCount: number;
}

const DEFAULT_CONCURRENCY = 8;
const MAX_CONCURRENCY = 32;
const DEFAULT_TIMEOUT = 30000;
const MAX_TIMEOUT = 120000;
const USER_AGENT = 'BFFless-FeedParser/1.0 (+https://bffless.app)';

/**
 * xml_feed_parse — a generic pipeline handler that fetches one or more feed
 * URLs (bounded concurrency) — or accepts raw XML from a prior step — and parses
 * RSS 2.0 / Atom / RDF into a normalized, format-neutral entry list via the pure
 * {@link FeedParserService}.
 *
 * Deliberately free of any RSS-reader/app knowledge: it is a general XML-feed
 * consumer. App-specific behavior belongs in the output as data, decided by the
 * consuming pipeline — never as a flag here.
 *
 * A malformed or unreachable source records a per-source error and does not sink
 * the batch: `entries` carries what parsed, `sources[]` carries each outcome.
 */
@Injectable()
export class XmlFeedParseHandler implements StepHandler<XmlFeedParseHandlerConfig> {
  readonly type = 'xml_feed_parse' as const;
  private readonly logger = new Logger(XmlFeedParseHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly feedParser: FeedParserService,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: XmlFeedParseHandlerConfig): void {
    const hasUrls = typeof config.urls === 'string' && config.urls.trim().length > 0;
    const hasXml = typeof config.xml === 'string' && config.xml.trim().length > 0;

    if (hasUrls && hasXml) {
      throw new ConfigurationError('Provide exactly one of "urls" or "xml"', 'xml_feed_parse');
    }
    if (!hasUrls && !hasXml) {
      throw new ConfigurationError('One of "urls" or "xml" is required', 'xml_feed_parse');
    }

    if (config.concurrency !== undefined) {
      if (
        typeof config.concurrency !== 'number' ||
        config.concurrency < 1 ||
        config.concurrency > MAX_CONCURRENCY
      ) {
        throw new ConfigurationError(
          `concurrency must be between 1 and ${MAX_CONCURRENCY}`,
          'xml_feed_parse',
        );
      }
    }

    if (config.timeoutMs !== undefined) {
      if (
        typeof config.timeoutMs !== 'number' ||
        config.timeoutMs < 1000 ||
        config.timeoutMs > MAX_TIMEOUT
      ) {
        throw new ConfigurationError(
          `timeoutMs must be between 1000 and ${MAX_TIMEOUT}`,
          'xml_feed_parse',
        );
      }
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as XmlFeedParseHandlerConfig;
    const stepName = step.name || 'xml_feed_parse';

    // Raw-XML mode: parse a single document supplied by a prior step.
    if (config.xml) {
      const xml = String(
        this.expressionEvaluator.evaluateExpression(config.xml, context, stepName) ?? '',
      );
      return this.parseSingle(xml, 'inline-xml');
    }

    // URL mode: resolve to one or many URLs and fetch/parse with bounded concurrency.
    const resolved = this.expressionEvaluator.evaluateExpression(config.urls!, context, stepName);
    const urls = this.normalizeUrls(resolved);

    if (urls.length === 0) {
      const empty: XmlFeedParseOutput = {
        entries: [],
        sources: [],
        totalEntries: 0,
        okCount: 0,
        errorCount: 0,
      };
      return { success: true, output: empty };
    }

    const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT;

    const results = await mapWithConcurrency(urls, concurrency, (url) =>
      this.fetchAndParse(url, timeoutMs),
    );

    return { success: true, output: this.aggregate(results) };
  }

  /** Parse a single already-in-hand XML document into the standard output shape. */
  private parseSingle(xml: string, source: string): StepResult {
    try {
      const parsed = this.feedParser.parse(xml, undefined);
      const entries = parsed.entries;
      const output: XmlFeedParseOutput = {
        entries,
        sources: [{ source, ok: true, count: entries.length }],
        totalEntries: entries.length,
        okCount: 1,
        errorCount: 0,
      };
      return { success: true, output };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.warn(`Failed to parse inline XML: ${message}`);
      const output: XmlFeedParseOutput = {
        entries: [],
        sources: [{ source, ok: false, count: 0, error: message }],
        totalEntries: 0,
        okCount: 0,
        errorCount: 1,
      };
      // A malformed body is a data outcome the next step can branch on, not a
      // pipeline-halting error.
      return { success: true, output };
    }
  }

  /**
   * Fetch one feed URL with a per-feed timeout and parse it. Any network,
   * timeout, HTTP, or parse failure is captured as a per-source error rather
   * than thrown, so one bad feed never sinks the batch.
   */
  private async fetchAndParse(
    url: string,
    timeoutMs: number,
  ): Promise<{ source: string; entries: FeedEntry[]; error?: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        return { source: url, entries: [], error: `HTTP ${response.status} ${response.statusText}` };
      }

      const body = await response.text();
      const parsed = this.feedParser.parse(body, url);
      return { source: url, entries: parsed.entries };
    } catch (error) {
      const err = error as Error;
      const message =
        err.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : err.message;
      this.logger.warn(`Feed source failed (${url}): ${message}`);
      return { source: url, entries: [], error: message };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Flatten per-source results into the aggregate output shape. */
  private aggregate(
    results: { source: string; entries: FeedEntry[]; error?: string }[],
  ): XmlFeedParseOutput {
    const entries: FeedEntry[] = [];
    const sources: SourceResult[] = [];
    let okCount = 0;
    let errorCount = 0;

    for (const r of results) {
      if (r.error) {
        errorCount++;
        sources.push({ source: r.source, ok: false, count: 0, error: r.error });
      } else {
        okCount++;
        entries.push(...r.entries);
        sources.push({ source: r.source, ok: true, count: r.entries.length });
      }
    }

    return { entries, sources, totalEntries: entries.length, okCount, errorCount };
  }

  /** Accept a single URL string or an array of them; drop blanks/non-strings. */
  private normalizeUrls(resolved: unknown): string[] {
    const list = Array.isArray(resolved) ? resolved : [resolved];
    return list
      .filter((u): u is string => typeof u === 'string')
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
  }
}

/**
 * Run `worker` over `items` with at most `limit` in flight at once, preserving
 * input order in the result. A tiny bounded-concurrency pool so we don't pull in
 * a dependency for what is a few lines.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });

  await Promise.all(runners);
  return results;
}
