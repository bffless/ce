import { Request } from 'express';
import {
  GoogleCalendarHandler,
  GoogleCalendarHandlerConfig,
} from './google-calendar.handler';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { GoogleCalendarOAuthService } from '../../integrations/google-calendar-oauth.service';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function makeFetchResponse(opts: {
  status: number;
  body?: unknown;
}): Response {
  const { status, body = {} } = opts;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    request: { headers: {} } as unknown as Request,
    stepOutputs: {},
    projectId: 'proj-1',
    pipelineId: 'pl-1',
    metadata: {
      path: '/',
      method: 'POST',
      headers: {},
      query: {},
      body: {},
    },
    ...overrides,
  };
}

function makeStep(config: Record<string, unknown>): PipelineStep {
  return {
    id: 'step-1',
    pipelineId: 'pl-1',
    name: 'gc',
    handlerType: 'google_calendar',
    config: config as PipelineStep['config'],
    order: 0,
    isEnabled: true,
  };
}

describe('GoogleCalendarHandler', () => {
  let handler: GoogleCalendarHandler;
  let oauthService: { getValidAccessToken: jest.Mock };

  beforeEach(() => {
    mockFetch.mockReset();
    const registry = { register: jest.fn() } as unknown as StepHandlerRegistry;
    const evaluator = new ExpressionEvaluator();
    oauthService = { getValidAccessToken: jest.fn().mockResolvedValue('access-tok') };
    handler = new GoogleCalendarHandler(
      registry,
      evaluator,
      oauthService as unknown as GoogleCalendarOAuthService,
    );
  });

  // ===== validateConfig =====

  describe('validateConfig', () => {
    it('requires action', () => {
      expect(() => handler.validateConfig({} as GoogleCalendarHandlerConfig)).toThrow(
        ConfigurationError,
      );
    });

    it('list_calendars has no required fields', () => {
      expect(() => handler.validateConfig({ action: 'list_calendars' })).not.toThrow();
    });

    it('freebusy requires calendarIds + timeMin + timeMax', () => {
      expect(() => handler.validateConfig({ action: 'freebusy' })).toThrow(/calendarIds/);
      expect(() =>
        handler.validateConfig({
          action: 'freebusy',
          calendarIds: ['primary'],
        }),
      ).toThrow(/timeMin and timeMax/);
    });

    it('create_event requires calendarId, summary, startTime, endTime', () => {
      expect(() => handler.validateConfig({ action: 'create_event' })).toThrow(/calendarId/);
      expect(() =>
        handler.validateConfig({ action: 'create_event', calendarId: 'c' }),
      ).toThrow(/summary/);
      expect(() =>
        handler.validateConfig({
          action: 'create_event',
          calendarId: 'c',
          summary: 's',
        }),
      ).toThrow(/startTime and endTime/);
    });

    it('update_event requires calendarId + eventId', () => {
      expect(() => handler.validateConfig({ action: 'update_event' })).toThrow(/calendarId/);
      expect(() =>
        handler.validateConfig({ action: 'update_event', calendarId: 'c' }),
      ).toThrow(/eventId/);
    });

    it('delete_event requires calendarId + eventId', () => {
      expect(() => handler.validateConfig({ action: 'delete_event' })).toThrow(/calendarId/);
      expect(() =>
        handler.validateConfig({ action: 'delete_event', calendarId: 'c' }),
      ).toThrow(/eventId/);
    });

    it('list_events requires calendarId', () => {
      expect(() => handler.validateConfig({ action: 'list_events' })).toThrow(/calendarId/);
    });
  });

  // ===== execute — token gating =====

  describe('execute — auth gating', () => {
    it('short-circuits with NOT_CONFIGURED when no access token', async () => {
      oauthService.getValidAccessToken.mockResolvedValueOnce(null);

      const result = await handler.execute(
        makeContext(),
        makeStep({ action: 'list_calendars' }),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GOOGLE_CALENDAR_NOT_CONFIGURED');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ===== Per-action =====

  describe('list_calendars', () => {
    it('GETs calendarList and unwraps items', async () => {
      mockFetch.mockResolvedValue(
        makeFetchResponse({
          status: 200,
          body: {
            items: [
              { id: 'a@x', summary: 'A', primary: true, timeZone: 'America/New_York' },
              { id: 'b@x', summary: 'B', timeZone: 'UTC' },
            ],
          },
        }),
      );

      const result = await handler.execute(makeContext(), makeStep({ action: 'list_calendars' }));

      expect(result.success).toBe(true);
      expect((result.output as any).calendars).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer access-tok' }),
        }),
      );
    });
  });

  describe('freebusy', () => {
    it('POSTs freeBusy with resolved calendar ids and timeMin/timeMax', async () => {
      mockFetch.mockResolvedValue(
        makeFetchResponse({
          status: 200,
          body: { calendars: { 'primary': { busy: [{ start: 's', end: 'e' }] } } },
        }),
      );

      // Simulate template evaluation through request.body
      const ctx = makeContext({
        metadata: {
          path: '/',
          method: 'POST',
          headers: {},
          query: {},
          body: { from: '2026-05-04T00:00:00Z', to: '2026-05-05T00:00:00Z' },
        },
      });

      const result = await handler.execute(
        ctx,
        makeStep({
          action: 'freebusy',
          calendarIds: ['primary'],
          timeMin: 'request.body.from',
          timeMax: 'request.body.to',
        }),
      );

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://www.googleapis.com/calendar/v3/freeBusy');
      expect(init.method).toBe('POST');
      const sentBody = JSON.parse(init.body as string);
      expect(sentBody).toMatchObject({
        timeMin: '2026-05-04T00:00:00Z',
        timeMax: '2026-05-05T00:00:00Z',
        items: [{ id: 'primary' }],
      });
    });
  });

  describe('list_events', () => {
    it('GETs events with default params and URL-encoded calendarId', async () => {
      mockFetch.mockResolvedValue(
        makeFetchResponse({
          status: 200,
          body: { items: [{ id: 'e1', summary: 'meeting', start: { dateTime: 's' } }] },
        }),
      );

      const result = await handler.execute(
        makeContext(),
        makeStep({
          action: 'list_events',
          calendarId: 'cal+with+plus@group.calendar.google.com',
        }),
      );

      expect(result.success).toBe(true);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('cal%2Bwith%2Bplus%40group.calendar.google.com');
      expect(url).toContain('singleEvents=true');
      expect(url).toContain('orderBy=startTime');
      expect((result.output as any).events).toHaveLength(1);
    });
  });

  describe('create_event', () => {
    it('POSTs event with templated summary + attendee email expressions', async () => {
      mockFetch.mockResolvedValue(
        makeFetchResponse({
          status: 200,
          body: {
            id: 'evt-1',
            summary: 'Haircut — Alice',
            htmlLink: 'https://cal/evt-1',
            start: { dateTime: '2026-05-04T10:00:00Z' },
            end: { dateTime: '2026-05-04T11:00:00Z' },
          },
        }),
      );

      const ctx = makeContext({
        metadata: {
          path: '/',
          method: 'POST',
          headers: {},
          query: {},
          body: {
            customer_name: 'Alice',
            customer_email: 'alice@example.com',
            start_time: '2026-05-04T10:00:00Z',
            end_time: '2026-05-04T11:00:00Z',
          },
        },
      });

      const result = await handler.execute(
        ctx,
        makeStep({
          action: 'create_event',
          calendarId: 'primary',
          summary: 'Haircut — {{request.body.customer_name}}',
          startTime: 'request.body.start_time',
          endTime: 'request.body.end_time',
          attendees: [{ email: 'request.body.customer_email' }],
          sendUpdates: 'all',
        }),
      );

      expect(result.success).toBe(true);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
      );
      const sent = JSON.parse(init.body as string);
      expect(sent.summary).toBe('Haircut — Alice');
      expect(sent.start.dateTime).toBe('2026-05-04T10:00:00Z');
      expect(sent.end.dateTime).toBe('2026-05-04T11:00:00Z');
      expect(sent.attendees).toEqual([{ email: 'alice@example.com' }]);
      expect((result.output as any).event.id).toBe('evt-1');
    });
  });

  describe('update_event', () => {
    it('PATCHes only supplied fields', async () => {
      mockFetch.mockResolvedValue(
        makeFetchResponse({
          status: 200,
          body: { id: 'evt-1', summary: 'Updated' },
        }),
      );

      const result = await handler.execute(
        makeContext(),
        makeStep({
          action: 'update_event',
          calendarId: 'primary',
          eventId: 'evt-1',
          summary: 'Updated',
        }),
      );

      expect(result.success).toBe(true);
      const [url, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe('PATCH');
      expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events/evt-1');
      const sent = JSON.parse(init.body as string);
      expect(sent.summary).toBe('Updated');
      expect(sent.start).toBeUndefined();
      expect(sent.end).toBeUndefined();
    });
  });

  describe('delete_event', () => {
    it('DELETEs and treats 204 as success', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse({ status: 204 }));

      const result = await handler.execute(
        makeContext(),
        makeStep({
          action: 'delete_event',
          calendarId: 'primary',
          eventId: 'evt-1',
          sendUpdates: 'none',
        }),
      );

      expect(result.success).toBe(true);
      expect((result.output as any).deleted).toBe(true);
      const [url, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe('DELETE');
      expect(url).toContain('sendUpdates=none');
    });

    it('treats 404 (already gone) as success', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse({ status: 404, body: {} }));

      const result = await handler.execute(
        makeContext(),
        makeStep({
          action: 'delete_event',
          calendarId: 'primary',
          eventId: 'evt-gone',
        }),
      );

      expect(result.success).toBe(true);
    });
  });

  // ===== Error mapping + 401 retry =====

  describe('error mapping', () => {
    it('maps 404 to NOT_FOUND (non-delete action)', async () => {
      mockFetch.mockResolvedValue(
        makeFetchResponse({ status: 404, body: { error: { message: 'Calendar not found' } } }),
      );

      const result = await handler.execute(
        makeContext(),
        makeStep({ action: 'list_events', calendarId: 'gone@x' }),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GOOGLE_CALENDAR_NOT_FOUND');
    });

    it('maps 429 to RATE_LIMITED', async () => {
      mockFetch.mockResolvedValue(
        makeFetchResponse({ status: 429, body: { error: { message: 'rate' } } }),
      );

      const result = await handler.execute(
        makeContext(),
        makeStep({ action: 'list_calendars' }),
      );

      expect(result.error?.code).toBe('GOOGLE_CALENDAR_RATE_LIMITED');
    });

    it('maps 5xx to API_ERROR', async () => {
      mockFetch.mockResolvedValue(
        makeFetchResponse({ status: 500, body: { error: { message: 'internal' } } }),
      );

      const result = await handler.execute(
        makeContext(),
        makeStep({ action: 'list_calendars' }),
      );

      expect(result.error?.code).toBe('GOOGLE_CALENDAR_API_ERROR');
    });
  });

  describe('401 retry', () => {
    it('forces token refresh and retries once on 401, succeeds on retry', async () => {
      // First call returns 401, second call returns 200
      mockFetch
        .mockResolvedValueOnce(makeFetchResponse({ status: 401, body: {} }))
        .mockResolvedValueOnce(
          makeFetchResponse({ status: 200, body: { items: [] } }),
        );

      // First getValidAccessToken (initial) returns the stale token; second
      // returns the fresh one for the retry.
      oauthService.getValidAccessToken
        .mockResolvedValueOnce('stale-tok')
        .mockResolvedValueOnce('fresh-tok');

      const result = await handler.execute(
        makeContext(),
        makeStep({ action: 'list_calendars' }),
      );

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      // The retry should use the fresh token
      const [, retryInit] = mockFetch.mock.calls[1];
      expect((retryInit.headers as any).Authorization).toBe('Bearer fresh-tok');
    });

    it('falls through to AUTH_FAILED if refresh also fails', async () => {
      mockFetch.mockResolvedValueOnce(makeFetchResponse({ status: 401, body: {} }));

      oauthService.getValidAccessToken
        .mockResolvedValueOnce('stale-tok')
        .mockResolvedValueOnce(null); // refresh failed

      const result = await handler.execute(
        makeContext(),
        makeStep({ action: 'list_calendars' }),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GOOGLE_CALENDAR_AUTH_FAILED');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
