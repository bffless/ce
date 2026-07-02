import { formatAccessLogLine, formatNginxTime } from './access-log.util';

describe('access-log.util', () => {
  describe('formatNginxTime', () => {
    it('formats a date like nginx $time_local in UTC', () => {
      expect(formatNginxTime(new Date('2026-07-02T09:05:03.000Z'))).toBe(
        '02/Jul/2026:09:05:03 +0000',
      );
    });
  });

  describe('formatAccessLogLine', () => {
    const base = {
      id: '1',
      timestamp: '2026-07-02T09:05:03.000Z',
      ip: '203.0.113.7',
      method: 'GET',
      path: '/backend/.env',
      httpVersion: '1.1',
      status: 404,
      bytes: 1234,
      referer: null as string | null,
      userAgent: 'Mozilla/5.0 (scanner)' as string | null,
      host: 'j5s.dev',
      classification: 'unmatched' as const,
    };

    it('renders the combined log format', () => {
      expect(formatAccessLogLine(base)).toBe(
        '203.0.113.7 - - [02/Jul/2026:09:05:03 +0000] "GET /backend/.env HTTP/1.1" 404 1234 "-" "Mozilla/5.0 (scanner)"',
      );
    });

    it('renders missing referer and user-agent as "-"', () => {
      const line = formatAccessLogLine({ ...base, userAgent: null });
      expect(line).toContain('"-" "-"');
    });

    it('includes the referer when present', () => {
      const line = formatAccessLogLine({ ...base, referer: 'https://example.com/' });
      expect(line).toContain('"https://example.com/"');
    });
  });
});
