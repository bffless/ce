import { Injectable, Logger } from '@nestjs/common';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

/**
 * A single media attachment on a feed entry (RSS `<enclosure>` / Atom
 * `<link rel="enclosure">`). This is what surfaces podcast audio so a podcast
 * app can consume the same normalized shape as an RSS reader.
 */
export interface FeedEnclosure {
  url: string;
  type?: string;
  length?: number;
}

/**
 * Format-neutral feed entry. RSS 2.0, Atom, and RDF (RSS 1.0) are all mapped
 * onto this one shape so a consuming pipeline never has to branch on format.
 *
 * `extensions` carries through any namespaced tag we did not explicitly map
 * (e.g. `itunes:duration`, `dc:creator`) keyed by its raw tag name, so a
 * consumer can read what it needs without this parser knowing about it. This is
 * the guardrail from the PRD: app-specific knowledge lives in the output as
 * data, decided by the consumer — never as a flag on the parser.
 */
export interface FeedEntry {
  /** The feed this entry came from — the source URL when known, else the feed title. */
  source?: string;
  /** Stable identifier: RSS `<guid>` / Atom `<id>` / RDF `rdf:about`, falling back to link. */
  guid?: string;
  title?: string;
  link?: string;
  author?: string;
  /** Publication date normalized to an ISO 8601 string, or undefined if unparseable/absent. */
  publishedAt?: string;
  /** Full content: RSS `content:encoded` / Atom `<content>`, falling back to the summary. */
  content?: string;
  /** Short summary: RSS/RDF `<description>` / Atom `<summary>`. */
  summary?: string;
  enclosures: FeedEnclosure[];
  extensions: Record<string, unknown>;
}

/**
 * Result of parsing one feed document.
 */
export interface ParsedFeed {
  format: 'rss' | 'atom' | 'rdf';
  title?: string;
  link?: string;
  entries: FeedEntry[];
}

/** Tags handled explicitly per format — never copied into `extensions`. */
const RSS_MAPPED = new Set([
  'title',
  'link',
  'description',
  'author',
  'guid',
  'pubdate',
  'enclosure',
  'content:encoded',
  'dc:creator',
  'dc:date',
]);
const ATOM_MAPPED = new Set([
  'title',
  'link',
  'summary',
  'content',
  'author',
  'id',
  'published',
  'updated',
]);

/**
 * Pure, app-agnostic parser: string in → normalized entries out. Detects
 * RSS 2.0 / Atom / RDF and maps each onto the {@link FeedEntry} shape. It knows
 * data formats, not applications, so it is reusable by any XML-feed consumer
 * (RSS reader today, podcast app tomorrow).
 *
 * Deliberately dependency-light and side-effect-free — no fetching happens here
 * (that lives in the handler); this class only transforms XML text.
 */
@Injectable()
export class FeedParserService {
  private readonly logger = new Logger(FeedParserService.name);

  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    trimValues: true,
    // Keep everything as strings; we do our own number/date coercion so a
    // guid like "007" or a numeric-looking title never changes type on us.
    parseTagValue: false,
    parseAttributeValue: false,
    // Preserve namespace prefixes (content:encoded, itunes:*, dc:*) — the
    // whole point of extensions{} passthrough.
    removeNSPrefix: false,
  });

  /**
   * Parse a feed document into normalized entries.
   *
   * @param xml Raw feed XML (RSS 2.0 / Atom / RDF).
   * @param source Optional source URL — used as each entry's `source`, and as
   *   the base for resolving relative links to absolute URLs.
   * @throws Error if the document is not well-formed XML or is not a recognized
   *   feed format. Callers that batch many feeds should catch this per-source so
   *   one bad feed does not sink the batch.
   */
  parse(xml: string, source?: string): ParsedFeed {
    if (typeof xml !== 'string' || xml.trim().length === 0) {
      throw new Error('Feed document is empty');
    }

    // Validate first: fast-xml-parser's parser is lenient and would silently
    // produce a garbage tree from unclosed/mismatched tags. A feed reader wants
    // malformed input to fail loudly so the batch can record a per-source error.
    const valid = XMLValidator.validate(xml);
    if (valid !== true) {
      throw new Error(`Malformed XML: ${valid.err.msg} (line ${valid.err.line})`);
    }

    let root: Record<string, unknown>;
    try {
      root = this.parser.parse(xml) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`Malformed XML: ${(error as Error).message}`);
    }

    if (!root || typeof root !== 'object') {
      throw new Error('Feed document did not parse to an object');
    }

    // RSS 2.0: <rss><channel><item>...
    if (root.rss && typeof root.rss === 'object') {
      return this.parseRss(root.rss as Record<string, unknown>, source);
    }
    // Atom: <feed><entry>...
    if (root.feed && typeof root.feed === 'object') {
      return this.parseAtom(root.feed as Record<string, unknown>, source);
    }
    // RDF / RSS 1.0: <rdf:RDF><channel/><item>... (items are siblings of channel)
    const rdf = (root['rdf:RDF'] ?? root.RDF) as Record<string, unknown> | undefined;
    if (rdf && typeof rdf === 'object') {
      return this.parseRdf(rdf, source);
    }

    throw new Error('Unrecognized feed format (expected RSS, Atom, or RDF root element)');
  }

  // ==================== RSS 2.0 ====================

  private parseRss(rss: Record<string, unknown>, source?: string): ParsedFeed {
    const channel = (rss.channel ?? {}) as Record<string, unknown>;
    const feedLink = this.text(channel.link);
    const base = source || feedLink;
    const items = toArray(channel.item);

    return {
      format: 'rss',
      title: this.text(channel.title),
      link: feedLink,
      entries: items.map((item) => this.rssEntry(item, source ?? this.text(channel.title), base)),
    };
  }

  private rssEntry(
    item: Record<string, unknown>,
    source: string | undefined,
    base: string | undefined,
  ): FeedEntry {
    const link = this.resolveUrl(this.text(item.link), base);
    const description = this.text(item.description);
    const encoded = this.text(item['content:encoded']);
    const guid = this.text(item.guid) || link;
    const author = this.text(item.author) || this.text(item['dc:creator']);
    const publishedAt = this.toIso(this.text(item.pubDate) || this.text(item['dc:date']));

    return {
      source,
      guid: guid || undefined,
      title: this.text(item.title),
      link,
      author: author || undefined,
      publishedAt,
      content: encoded || description || undefined,
      summary: description || undefined,
      enclosures: this.rssEnclosures(item, base),
      extensions: this.collectExtensions(item, RSS_MAPPED),
    };
  }

  private rssEnclosures(
    item: Record<string, unknown>,
    base: string | undefined,
  ): FeedEnclosure[] {
    return toArray(item.enclosure)
      .map((enc) => {
        const url = this.resolveUrl(this.attr(enc, 'url'), base);
        if (!url) return null;
        const length = this.attr(enc, 'length');
        return {
          url,
          type: this.attr(enc, 'type') || undefined,
          length: length ? Number(length) || undefined : undefined,
        } as FeedEnclosure;
      })
      .filter((e): e is FeedEnclosure => e !== null);
  }

  // ==================== Atom ====================

  private parseAtom(feed: Record<string, unknown>, source?: string): ParsedFeed {
    const feedLink = this.atomLink(feed.link, undefined);
    const base = source || feedLink;
    const entries = toArray(feed.entry);

    return {
      format: 'atom',
      title: this.text(feed.title),
      link: feedLink,
      entries: entries.map((entry) =>
        this.atomEntry(entry, source ?? this.text(feed.title), base),
      ),
    };
  }

  private atomEntry(
    entry: Record<string, unknown>,
    source: string | undefined,
    base: string | undefined,
  ): FeedEntry {
    // Prefer the 'alternate' link (or a link with no rel) for the canonical URL.
    const link = this.resolveUrl(this.atomLink(entry.link, 'alternate'), base);
    const summary = this.text(entry.summary);
    const content = this.text(entry.content);
    const guid = this.text(entry.id) || link;
    const publishedAt = this.toIso(this.text(entry.published) || this.text(entry.updated));

    return {
      source,
      guid: guid || undefined,
      title: this.text(entry.title),
      link,
      author: this.atomAuthor(entry.author),
      publishedAt,
      content: content || summary || undefined,
      summary: summary || undefined,
      enclosures: this.atomEnclosures(entry.link, base),
      extensions: this.collectExtensions(entry, ATOM_MAPPED),
    };
  }

  /**
   * Resolve an Atom `<link>` (possibly an array) to an href. When `rel` is
   * given, prefer a link with that rel or with no rel at all; otherwise take
   * the first link.
   */
  private atomLink(link: unknown, rel: string | undefined): string | undefined {
    const links = toArray(link);
    if (links.length === 0) return undefined;

    if (rel) {
      const match = links.find((l) => {
        const r = this.attr(l, 'rel');
        return r === rel || r === undefined || r === '';
      });
      if (match) return this.attr(match, 'href') || this.text(match) || undefined;
    }

    const first = links[0];
    return this.attr(first, 'href') || this.text(first) || undefined;
  }

  private atomEnclosures(link: unknown, base: string | undefined): FeedEnclosure[] {
    return toArray(link)
      .filter((l) => this.attr(l, 'rel') === 'enclosure')
      .map((l) => {
        const url = this.resolveUrl(this.attr(l, 'href'), base);
        if (!url) return null;
        const length = this.attr(l, 'length');
        return {
          url,
          type: this.attr(l, 'type') || undefined,
          length: length ? Number(length) || undefined : undefined,
        } as FeedEnclosure;
      })
      .filter((e): e is FeedEnclosure => e !== null);
  }

  private atomAuthor(author: unknown): string | undefined {
    const first = toArray(author)[0];
    if (!first) return undefined;
    return this.text((first as Record<string, unknown>).name) || this.text(first) || undefined;
  }

  // ==================== RDF / RSS 1.0 ====================

  private parseRdf(rdf: Record<string, unknown>, source?: string): ParsedFeed {
    const channel = (rdf.channel ?? {}) as Record<string, unknown>;
    const feedLink = this.text(channel.link);
    const base = source || feedLink;
    // In RSS 1.0 items are siblings of <channel>, not children.
    const items = toArray(rdf.item);

    return {
      format: 'rdf',
      title: this.text(channel.title),
      link: feedLink,
      entries: items.map((item) => this.rdfEntry(item, source ?? this.text(channel.title), base)),
    };
  }

  private rdfEntry(
    item: Record<string, unknown>,
    source: string | undefined,
    base: string | undefined,
  ): FeedEntry {
    const link = this.resolveUrl(this.text(item.link), base);
    const description = this.text(item.description);
    const guid = this.attr(item, 'rdf:about') || link;
    const author = this.text(item['dc:creator']);
    const publishedAt = this.toIso(this.text(item['dc:date']));

    return {
      source,
      guid: guid || undefined,
      title: this.text(item.title),
      link,
      author: author || undefined,
      publishedAt,
      content: this.text(item['content:encoded']) || description || undefined,
      summary: description || undefined,
      enclosures: [],
      extensions: this.collectExtensions(item, RSS_MAPPED),
    };
  }

  // ==================== Shared helpers ====================

  /**
   * Extract the text value of a node. fast-xml-parser gives either a scalar
   * (text-only node) or an object `{ '#text': ..., '@_attr': ... }` (node with
   * attributes). Returns undefined for absent/empty values.
   */
  private text(node: unknown): string | undefined {
    if (node === undefined || node === null) return undefined;
    if (typeof node === 'string') {
      const t = node.trim();
      return t.length > 0 ? t : undefined;
    }
    if (typeof node === 'number' || typeof node === 'boolean') {
      return String(node);
    }
    if (typeof node === 'object') {
      const inner = (node as Record<string, unknown>)['#text'];
      if (inner !== undefined) return this.text(inner);
    }
    return undefined;
  }

  /** Read an attribute (stored by fast-xml-parser under the `@_` prefix). */
  private attr(node: unknown, name: string): string | undefined {
    if (!node || typeof node !== 'object') return undefined;
    const value = (node as Record<string, unknown>)[`@_${name}`];
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length > 0 ? s : undefined;
  }

  /**
   * Collect every namespaced child tag (contains a ':') that we did not map
   * explicitly, keyed by its raw tag name, into the passthrough extensions map.
   */
  private collectExtensions(
    node: Record<string, unknown>,
    mapped: Set<string>,
  ): Record<string, unknown> {
    const extensions: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('@_') || key === '#text') continue;
      if (!key.includes(':')) continue; // only namespaced tags are extensions
      if (mapped.has(key.toLowerCase())) continue;
      extensions[key] = value;
    }
    return extensions;
  }

  /**
   * Resolve a possibly-relative URL against the feed's base URL. Returns the
   * input unchanged if it's already absolute or if no usable base exists.
   */
  private resolveUrl(url: string | undefined, base: string | undefined): string | undefined {
    if (!url) return undefined;
    if (!base) return url;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url; // already absolute
    try {
      return new URL(url, base).toString();
    } catch {
      return url;
    }
  }

  /**
   * Normalize a date string (RFC 822 for RSS, RFC 3339 for Atom, ISO for RDF)
   * to an ISO 8601 string. Returns undefined if absent or unparseable — a bad
   * date should never sink an entry.
   */
  private toIso(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) {
      this.logger.debug(`Unparseable feed date: "${value}"`);
      return undefined;
    }
    return new Date(ms).toISOString();
  }
}

/** Wrap fast-xml-parser output (scalar | object | array) into an array of objects. */
function toArray(value: unknown): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.filter((v) => v !== undefined && v !== null) as Record<string, unknown>[];
  }
  return [value as Record<string, unknown>];
}
