import { Injectable, Logger } from '@nestjs/common';
import { StepHandler, BaseHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';
import { GoogleCalendarOAuthService } from '../../integrations/google-calendar-oauth.service';

const GOOGLE_CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

export type GoogleCalendarAction =
  | 'list_calendars'
  | 'freebusy'
  | 'list_events'
  | 'create_event'
  | 'update_event'
  | 'delete_event';

export interface GoogleCalendarHandlerConfig extends BaseHandlerConfig {
  /** Calendar API action to perform. */
  action: GoogleCalendarAction;

  // ---- freebusy ----
  /** Single calendar id or array of ids (expression-evaluated). */
  calendarIds?: string | string[];
  /** ISO 8601 expression — start of the freeBusy / list_events window. */
  timeMin?: string;
  /** ISO 8601 expression — end of the freeBusy / list_events window. */
  timeMax?: string;
  /** IANA timezone (e.g. "America/New_York"). */
  timezone?: string;

  // ---- list_events / create_event / update_event / delete_event ----
  /** Calendar id (expression-evaluated). For list/create/update/delete. */
  calendarId?: string;
  /** Event id (expression-evaluated). For update/delete. */
  eventId?: string;
  /** Max events to return (list_events). Default 250. */
  maxResults?: number;
  /** Expand recurring events into instances (list_events). Default true. */
  singleEvents?: boolean;
  /** Sort order for list_events. Default 'startTime'. */
  orderBy?: 'startTime' | 'updated';

  // ---- create_event / update_event ----
  /** Event summary/title (template). */
  summary?: string;
  /** Event description (template). */
  description?: string;
  /** Event location (template). */
  location?: string;
  /** Start time, ISO 8601 (expression). */
  startTime?: string;
  /** End time, ISO 8601 (expression). */
  endTime?: string;
  /** Attendee email entries. Each `email` is expression-evaluated. */
  attendees?: Array<{ email: string }>;
  /** Whether Google sends notifications. Defaults to 'none' for safety. */
  sendUpdates?: 'all' | 'externalOnly' | 'none';

  /**
   * When true, downstream "Google not available" failures (NOT_CONFIGURED /
   * AUTH_FAILED / NOT_FOUND) return success with `output: { skipped: true,
   * reason }` instead of erroring out. Lets pipelines treat the integration
   * as a soft, layered enhancement on top of a DB-as-truth booking flow
   * (see scheduling design decisions §12). Transient failures (rate limits,
   * 5xx, network errors) still bubble up — they're recoverable, the others
   * aren't.
   * @default false
   */
  optional?: boolean;
}

/** Soft-failable error codes when `optional: true`. */
const SOFT_FAIL_CODES = new Set<string>([
  'GOOGLE_CALENDAR_NOT_CONFIGURED',
  'GOOGLE_CALENDAR_AUTH_FAILED',
  'GOOGLE_CALENDAR_NOT_FOUND',
]);

function softFailReason(code: string): 'not_configured' | 'auth_failed' | 'not_found' {
  switch (code) {
    case 'GOOGLE_CALENDAR_NOT_CONFIGURED':
      return 'not_configured';
    case 'GOOGLE_CALENDAR_AUTH_FAILED':
      return 'auth_failed';
    case 'GOOGLE_CALENDAR_NOT_FOUND':
      return 'not_found';
    default:
      return 'not_configured'; // unreachable — guarded by SOFT_FAIL_CODES
  }
}

const ERROR_CODES = {
  NOT_CONFIGURED: 'GOOGLE_CALENDAR_NOT_CONFIGURED',
  AUTH_FAILED: 'GOOGLE_CALENDAR_AUTH_FAILED',
  NOT_FOUND: 'GOOGLE_CALENDAR_NOT_FOUND',
  RATE_LIMITED: 'GOOGLE_CALENDAR_RATE_LIMITED',
  API_ERROR: 'GOOGLE_CALENDAR_API_ERROR',
} as const;

/**
 * Google Calendar pipeline step handler.
 *
 * One handler, six actions: list_calendars, freebusy, list_events,
 * create_event, update_event, delete_event. OAuth refresh is handled by
 * `GoogleCalendarOAuthService`; on a 401 from Google we force a refresh and
 * retry the call once before mapping to AUTH_FAILED.
 *
 * Requires the `google-calendar` integration to be configured on the project
 * (see `IntegrationsService` and Phase A).
 */
@Injectable()
export class GoogleCalendarHandler implements StepHandler<GoogleCalendarHandlerConfig> {
  readonly type = 'google_calendar' as const;
  private readonly logger = new Logger(GoogleCalendarHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly googleCalendarOAuthService: GoogleCalendarOAuthService,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: GoogleCalendarHandlerConfig): void {
    if (!config.action) {
      throw new ConfigurationError('action is required', 'google_calendar');
    }

    switch (config.action) {
      case 'list_calendars':
        // No required fields
        return;

      case 'freebusy':
        if (!config.calendarIds) {
          throw new ConfigurationError('calendarIds is required for freebusy', 'google_calendar');
        }
        if (!config.timeMin || !config.timeMax) {
          throw new ConfigurationError(
            'timeMin and timeMax are required for freebusy',
            'google_calendar',
          );
        }
        return;

      case 'list_events':
        if (!config.calendarId) {
          throw new ConfigurationError('calendarId is required for list_events', 'google_calendar');
        }
        return;

      case 'create_event':
        if (!config.calendarId) {
          throw new ConfigurationError(
            'calendarId is required for create_event',
            'google_calendar',
          );
        }
        if (!config.summary) {
          throw new ConfigurationError('summary is required for create_event', 'google_calendar');
        }
        if (!config.startTime || !config.endTime) {
          throw new ConfigurationError(
            'startTime and endTime are required for create_event',
            'google_calendar',
          );
        }
        return;

      case 'update_event':
        if (!config.calendarId) {
          throw new ConfigurationError(
            'calendarId is required for update_event',
            'google_calendar',
          );
        }
        if (!config.eventId) {
          throw new ConfigurationError('eventId is required for update_event', 'google_calendar');
        }
        return;

      case 'delete_event':
        if (!config.calendarId) {
          throw new ConfigurationError(
            'calendarId is required for delete_event',
            'google_calendar',
          );
        }
        if (!config.eventId) {
          throw new ConfigurationError('eventId is required for delete_event', 'google_calendar');
        }
        return;

      default: {
        // Exhaustiveness guard — TypeScript catches missing actions at compile time
        const _exhaustive: never = config.action;
        throw new ConfigurationError(
          `Unknown action '${_exhaustive}'. Supported: list_calendars, freebusy, list_events, create_event, update_event, delete_event`,
          'google_calendar',
        );
      }
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as GoogleCalendarHandlerConfig;
    const result = await this.executeInner(context, step, config);
    return this.maybeSoftFail(result, config);
  }

  /**
   * Pre-soft-fail dispatch — same shape as the original execute. The wrapper
   * above filters the result through the soft-fail policy when `optional`
   * is set.
   */
  private async executeInner(
    context: PipelineContext,
    step: PipelineStep,
    config: GoogleCalendarHandlerConfig,
  ): Promise<StepResult> {
    const token = await this.googleCalendarOAuthService.getValidAccessToken(context.projectId);
    if (!token) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.NOT_CONFIGURED,
          message:
            'Google Calendar integration is not configured (or OAuth not completed) for this project.',
        },
      };
    }

    try {
      switch (config.action) {
        case 'list_calendars':
          return await this.listCalendars(context, token);
        case 'freebusy':
          return await this.freeBusy(config, context, step, token);
        case 'list_events':
          return await this.listEvents(config, context, step, token);
        case 'create_event':
          return await this.createEvent(config, context, step, token);
        case 'update_event':
          return await this.updateEvent(config, context, step, token);
        case 'delete_event':
          return await this.deleteEvent(config, context, step, token);
        default: {
          const _exhaustive: never = config.action;
          return {
            success: false,
            error: {
              code: ERROR_CODES.API_ERROR,
              message: `Unknown google_calendar action: ${String(_exhaustive)}`,
            },
          };
        }
      }
    } catch (error: any) {
      this.logger.error(`google_calendar request failed for step '${step.name}': ${error.message}`);
      return {
        success: false,
        error: {
          code: ERROR_CODES.API_ERROR,
          message: `Google Calendar request failed: ${error.message}`,
        },
      };
    }
  }

  /**
   * If `config.optional === true` and the result is a soft-failable error,
   * convert to success-with-warning. Hard errors (5xx, rate-limit, network)
   * pass through unchanged because they're transient — pipelines should
   * surface them, not pretend nothing happened.
   */
  private maybeSoftFail(result: StepResult, config: GoogleCalendarHandlerConfig): StepResult {
    if (result.success) return result;
    if (!config.optional) return result;
    const code = result.error?.code;
    if (!code || !SOFT_FAIL_CODES.has(code)) return result;
    const reason = softFailReason(code);
    return {
      success: true,
      output: { skipped: true, reason },
      warning: result.error?.message ?? `Google Calendar step skipped: ${reason}`,
    };
  }

  // ===== Actions =====

  private async listCalendars(context: PipelineContext, token: string): Promise<StepResult> {
    const r = await this.fetchWith401Retry(
      context,
      `${GOOGLE_CALENDAR_BASE}/users/me/calendarList`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!r.ok) return await this.httpErrorResult(r);
    const body = await r.json();
    return {
      success: true,
      output: {
        calendars: (body.items ?? []).map((c: any) => ({
          id: c.id,
          summary: c.summary,
          primary: !!c.primary,
          timeZone: c.timeZone,
        })),
      },
    };
  }

  private async freeBusy(
    config: GoogleCalendarHandlerConfig,
    context: PipelineContext,
    step: PipelineStep,
    token: string,
  ): Promise<StepResult> {
    const calendarIds = this.resolveCalendarIds(config.calendarIds!, context, step);
    const timeMin = String(
      this.expressionEvaluator.evaluateExpression(config.timeMin!, context, step.name),
    );
    const timeMax = String(
      this.expressionEvaluator.evaluateExpression(config.timeMax!, context, step.name),
    );

    const requestBody: Record<string, unknown> = {
      timeMin,
      timeMax,
      items: calendarIds.map((id) => ({ id })),
    };
    if (config.timezone) requestBody.timeZone = config.timezone;

    const r = await this.fetchWith401Retry(context, `${GOOGLE_CALENDAR_BASE}/freeBusy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    if (!r.ok) return await this.httpErrorResult(r);
    const body = await r.json();
    return {
      success: true,
      output: { calendars: body.calendars ?? {}, timeMin, timeMax },
    };
  }

  private async listEvents(
    config: GoogleCalendarHandlerConfig,
    context: PipelineContext,
    step: PipelineStep,
    token: string,
  ): Promise<StepResult> {
    const calendarId = String(
      this.expressionEvaluator.evaluateExpression(config.calendarId!, context, step.name),
    );

    const params = new URLSearchParams();
    if (config.timeMin) {
      params.set(
        'timeMin',
        String(this.expressionEvaluator.evaluateExpression(config.timeMin, context, step.name)),
      );
    }
    if (config.timeMax) {
      params.set(
        'timeMax',
        String(this.expressionEvaluator.evaluateExpression(config.timeMax, context, step.name)),
      );
    }
    params.set('maxResults', String(config.maxResults ?? 250));
    params.set('singleEvents', String(config.singleEvents ?? true));
    params.set('orderBy', config.orderBy ?? 'startTime');

    const url = `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;

    const r = await this.fetchWith401Retry(context, url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return await this.httpErrorResult(r);
    const body = await r.json();
    return {
      success: true,
      output: {
        events: (body.items ?? []).map((e: any) => this.summarizeEvent(e)),
        nextPageToken: body.nextPageToken ?? null,
      },
    };
  }

  private async createEvent(
    config: GoogleCalendarHandlerConfig,
    context: PipelineContext,
    step: PipelineStep,
    token: string,
  ): Promise<StepResult> {
    const calendarId = String(
      this.expressionEvaluator.evaluateExpression(config.calendarId!, context, step.name),
    );

    const eventBody = this.buildEventBody(config, context, step, /* requireTimes */ true);

    const url = new URL(
      `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    );
    if (config.sendUpdates) url.searchParams.set('sendUpdates', config.sendUpdates);

    const r = await this.fetchWith401Retry(context, url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventBody),
    });
    if (!r.ok) return await this.httpErrorResult(r);
    const event = await r.json();
    this.logger.log(`Created event ${event.id} on calendar ${calendarId}`);
    return { success: true, output: { event: this.summarizeEvent(event) } };
  }

  private async updateEvent(
    config: GoogleCalendarHandlerConfig,
    context: PipelineContext,
    step: PipelineStep,
    token: string,
  ): Promise<StepResult> {
    const calendarId = String(
      this.expressionEvaluator.evaluateExpression(config.calendarId!, context, step.name),
    );
    const eventId = String(
      this.expressionEvaluator.evaluateExpression(config.eventId!, context, step.name),
    );

    const eventBody = this.buildEventBody(config, context, step, /* requireTimes */ false);

    const url = new URL(
      `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    );
    if (config.sendUpdates) url.searchParams.set('sendUpdates', config.sendUpdates);

    const r = await this.fetchWith401Retry(context, url.toString(), {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventBody),
    });
    if (!r.ok) return await this.httpErrorResult(r);
    const event = await r.json();
    this.logger.log(`Updated event ${event.id} on calendar ${calendarId}`);
    return { success: true, output: { event: this.summarizeEvent(event) } };
  }

  private async deleteEvent(
    config: GoogleCalendarHandlerConfig,
    context: PipelineContext,
    step: PipelineStep,
    token: string,
  ): Promise<StepResult> {
    const calendarId = String(
      this.expressionEvaluator.evaluateExpression(config.calendarId!, context, step.name),
    );
    const eventId = String(
      this.expressionEvaluator.evaluateExpression(config.eventId!, context, step.name),
    );

    const url = new URL(
      `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    );
    if (config.sendUpdates) url.searchParams.set('sendUpdates', config.sendUpdates);

    const r = await this.fetchWith401Retry(context, url.toString(), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    // 204 = deleted, 410/404 = already gone — both treated as success
    if (r.ok || r.status === 404 || r.status === 410) {
      this.logger.log(`Deleted event ${eventId} on calendar ${calendarId} (status ${r.status})`);
      return { success: true, output: { eventId, calendarId, deleted: true } };
    }
    return await this.httpErrorResult(r);
  }

  // ===== Helpers =====

  /** Resolve calendarIds (string or array) — each entry runs through the expression evaluator. */
  private resolveCalendarIds(
    raw: string | string[],
    context: PipelineContext,
    step: PipelineStep,
  ): string[] {
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map((id) =>
      String(this.expressionEvaluator.evaluateExpression(id, context, step.name)),
    );
  }

  /** Build a Google Calendar event body from config, applying templates / expressions. */
  private buildEventBody(
    config: GoogleCalendarHandlerConfig,
    context: PipelineContext,
    step: PipelineStep,
    requireTimes: boolean,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {};

    if (config.summary) {
      body.summary = this.expressionEvaluator.evaluateTemplate(config.summary, context, step.name);
    }
    if (config.description) {
      body.description = this.expressionEvaluator.evaluateTemplate(
        config.description,
        context,
        step.name,
      );
    }
    if (config.location) {
      body.location = this.expressionEvaluator.evaluateTemplate(
        config.location,
        context,
        step.name,
      );
    }

    if (requireTimes || config.startTime) {
      body.start = {
        dateTime: String(
          this.expressionEvaluator.evaluateExpression(config.startTime!, context, step.name),
        ),
        ...(config.timezone ? { timeZone: config.timezone } : {}),
      };
    }
    if (requireTimes || config.endTime) {
      body.end = {
        dateTime: String(
          this.expressionEvaluator.evaluateExpression(config.endTime!, context, step.name),
        ),
        ...(config.timezone ? { timeZone: config.timezone } : {}),
      };
    }

    if (config.attendees && config.attendees.length > 0) {
      body.attendees = config.attendees.map((a) => ({
        email: String(this.expressionEvaluator.evaluateExpression(a.email, context, step.name)),
      }));
    }

    return body;
  }

  /** Stable shape returned from create/update/list. */
  private summarizeEvent(event: any) {
    return {
      id: event.id,
      summary: event.summary,
      description: event.description,
      location: event.location,
      start: event.start?.dateTime || event.start?.date || null,
      end: event.end?.dateTime || event.end?.date || null,
      attendees: (event.attendees ?? []).map((a: any) => ({
        email: a.email,
        responseStatus: a.responseStatus,
      })),
      htmlLink: event.htmlLink,
      status: event.status,
    };
  }

  /**
   * Fetch with one-shot 401 retry. `getValidAccessToken` already refreshes when
   * within 60s of expiry, but a token can still expire between that check and
   * the actual API call (rare on long-running pipelines, but real). On 401 we
   * force a fresh token via `getValidAccessToken` and retry once.
   */
  private async fetchWith401Retry(
    context: PipelineContext,
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const response = await fetch(url, init);
    if (response.status !== 401) return response;

    const fresh = await this.googleCalendarOAuthService.getValidAccessToken(context.projectId);
    if (!fresh) return response; // refresh failed — let httpErrorResult map the original 401

    const headers = {
      ...(init.headers as Record<string, string>),
      Authorization: `Bearer ${fresh}`,
    };
    return fetch(url, { ...init, headers });
  }

  private async httpErrorResult(response: Response): Promise<StepResult> {
    let detail: any = {};
    try {
      detail = await response.json();
    } catch {
      // body wasn't JSON
    }
    const message = detail?.error?.message || `HTTP ${response.status}`;
    const code = (() => {
      switch (response.status) {
        case 401:
        case 403:
          return ERROR_CODES.AUTH_FAILED;
        case 404:
          return ERROR_CODES.NOT_FOUND;
        case 429:
          return ERROR_CODES.RATE_LIMITED;
        default:
          return ERROR_CODES.API_ERROR;
      }
    })();
    this.logger.error(`Google Calendar API ${response.status}: ${message}`);
    return {
      success: false,
      error: {
        code,
        message: `Google Calendar API error (${response.status}): ${message}`,
        details: { status: response.status, ...(detail?.error ? { google: detail.error } : {}) },
      },
    };
  }
}
