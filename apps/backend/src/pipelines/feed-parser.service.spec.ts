import * as fs from 'fs';
import * as path from 'path';
import { FeedParserService } from './feed-parser.service';

const FIXTURES = path.join(__dirname, '__fixtures__', 'feeds');
const fixture = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), 'utf-8');

describe('FeedParserService', () => {
  let parser: FeedParserService;

  beforeEach(() => {
    parser = new FeedParserService();
  });

  describe('RSS 2.0', () => {
    it('parses channel + items into normalized entries', () => {
      const feed = parser.parse(fixture('rss2.xml'), 'https://example.com/feed.xml');

      expect(feed.format).toBe('rss');
      expect(feed.title).toBe('Example RSS Feed');
      expect(feed.entries).toHaveLength(2);
    });

    it('maps guid, dates, author, and prefers content:encoded for content', () => {
      const [first] = parser.parse(fixture('rss2.xml')).entries;

      expect(first.title).toBe('First Post');
      expect(first.guid).toBe('post-0001');
      expect(first.author).toBe('alice@example.com');
      expect(first.publishedAt).toBe('2024-10-02T13:00:00.000Z');
      // content:encoded wins over description for `content`; description is `summary`
      expect(first.content).toContain('Full <b>HTML</b> content');
      expect(first.summary).toContain('Summary of the <b>first</b>');
    });

    it('resolves relative links against the source URL', () => {
      const [first] = parser.parse(fixture('rss2.xml'), 'https://example.com/feed.xml').entries;
      expect(first.link).toBe('https://example.com/posts/first');
    });

    it('falls back to link as guid when <guid> is absent', () => {
      const [, second] = parser.parse(fixture('rss2.xml')).entries;
      expect(second.guid).toBe('https://example.com/posts/second');
      // No content:encoded → content falls back to the description
      expect(second.content).toBe('Plain text summary, no guid so link is the id.');
    });
  });

  describe('Atom', () => {
    it('parses feed + entries and prefers the alternate link', () => {
      const feed = parser.parse(fixture('atom.xml'), 'https://example.com/atom.xml');

      expect(feed.format).toBe('atom');
      expect(feed.entries).toHaveLength(2);

      const [first] = feed.entries;
      expect(first.title).toBe('Atom Entry One');
      expect(first.guid).toBe('urn:uuid:1225c695-cfb8-4ebb-aaaa-80da344efa6a');
      expect(first.link).toBe('https://example.com/entries/one');
      expect(first.author).toBe('Bob Author');
      expect(first.publishedAt).toBe('2024-10-02T13:00:00.000Z');
      expect(first.content).toContain('Full content of');
      expect(first.summary).toBe('Short summary of entry one.');
    });

    it('falls back content to summary when <content> is absent', () => {
      const [, second] = parser.parse(fixture('atom.xml')).entries;
      expect(second.link).toBe('https://example.com/entries/two');
      expect(second.content).toBe('Only a summary here; content falls back to it.');
    });
  });

  describe('RDF / RSS 1.0', () => {
    it('parses items that are siblings of <channel>', () => {
      const feed = parser.parse(fixture('rdf.xml'));

      expect(feed.format).toBe('rdf');
      expect(feed.entries).toHaveLength(2);

      const [alpha] = feed.entries;
      expect(alpha.title).toBe('RDF Item Alpha');
      expect(alpha.guid).toBe('https://example.org/items/alpha');
      expect(alpha.author).toBe('Carol');
      expect(alpha.publishedAt).toBe('2024-10-01T12:00:00.000Z');
    });
  });

  describe('podcast with enclosure', () => {
    it('surfaces <enclosure> in enclosures[]', () => {
      const [ep] = parser.parse(fixture('podcast.xml')).entries;

      expect(ep.enclosures).toHaveLength(1);
      expect(ep.enclosures[0]).toEqual({
        url: 'https://cdn.example.com/audio/ep1.mp3',
        type: 'audio/mpeg',
        length: 15728640,
      });
    });

    it('preserves namespaced tags in extensions{}', () => {
      const [ep] = parser.parse(fixture('podcast.xml')).entries;

      expect(ep.extensions['itunes:duration']).toBe('00:32:10');
      // itunes:episode is a namespaced passthrough, not a mapped field
      expect(ep.extensions).toHaveProperty('itunes:episode');
      // mapped tags must never leak into extensions
      expect(ep.extensions).not.toHaveProperty('title');
      expect(ep.extensions).not.toHaveProperty('enclosure');
    });
  });

  describe('malformed / unrecognized input', () => {
    it('throws on malformed XML', () => {
      expect(() => parser.parse(fixture('malformed.xml'))).toThrow(/Malformed XML/);
    });

    it('throws on empty input', () => {
      expect(() => parser.parse('')).toThrow(/empty/i);
    });

    it('throws on well-formed but non-feed XML', () => {
      expect(() => parser.parse('<html><body>hi</body></html>')).toThrow(
        /Unrecognized feed format/,
      );
    });
  });
});
