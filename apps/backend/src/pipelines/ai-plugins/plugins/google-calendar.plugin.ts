import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { z } from 'zod';
import {
  AIToolPlugin,
  AIToolPluginMetadata,
  AIToolDefinition,
  AIToolContext,
} from '../ai-tool-plugin.interface';
import { AIToolPluginRegistry } from '../ai-tool-plugin.registry';
import { AIToolPluginService } from '../ai-tool-plugin.service';
import { GoogleOAuthService } from '../google-oauth.service';

const FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy';
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars';

@Injectable()
export class GoogleCalendarPlugin implements AIToolPlugin {
  readonly metadata: AIToolPluginMetadata = {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Check schedule availability and create calendar events via Google Calendar.',
    category: 'scheduling',
    icon: 'calendar',
    requiresOAuth: true,
    oauthProvider: 'google',
    configSchema: z.object({
      clientId: z.string().min(1).describe('Google OAuth Client ID'),
      clientSecret: z.string().min(1).describe('Google OAuth Client Secret'),
    }),
    pipelineOptionsSchema: z.object({
      calendarId: z.string().optional().describe('Calendar to use (defaults to primary)'),
      lookAheadDays: z
        .number()
        .min(1)
        .max(90)
        .optional()
        .describe('Days to look ahead for availability (default 7)'),
      maxSlots: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .describe('Maximum number of free slots to return (default: all)'),
      addGoogleMeet: z
        .boolean()
        .optional()
        .describe('Automatically add a Google Meet video conference link to created events'),
      additionalAttendees: z
        .array(z.string().email())
        .optional()
        .describe('Additional email addresses to always include as attendees on created events'),
    }),
  };

  constructor(
    private readonly registry: AIToolPluginRegistry,
    @Inject(forwardRef(() => AIToolPluginService))
    private readonly pluginService: AIToolPluginService,
    @Inject(forwardRef(() => GoogleOAuthService))
    private readonly oauthService: GoogleOAuthService,
  ) {
    this.registry.register(this);
  }

  async validateConfig(
    config: Record<string, unknown>,
  ): Promise<{ valid: boolean; error?: string }> {
    if (!config.clientId || typeof config.clientId !== 'string') {
      return { valid: false, error: 'Google OAuth Client ID is required' };
    }
    if (!config.clientSecret || typeof config.clientSecret !== 'string') {
      return { valid: false, error: 'Google OAuth Client Secret is required' };
    }
    return { valid: true };
  }

  getTools(config: Record<string, unknown>): AIToolDefinition[] {
    // Only return tools if OAuth flow has been completed
    if (!config.refreshToken) {
      return [];
    }

    return [
      {
        name: 'get_availability',
        description:
          'Check Google Calendar availability (free/busy times) for a date range. Returns both busy and free time slots.',
        inputSchema: z.object({
          startDate: z
            .string()
            .optional()
            .describe(
              'Start date/time in ISO 8601 format (e.g., "2024-03-15T09:00:00Z"). Defaults to now.',
            ),
          endDate: z
            .string()
            .optional()
            .describe(
              'End date/time in ISO 8601 format. Defaults to start + lookAheadDays (default 7 days).',
            ),
          timezone: z
            .string()
            .optional()
            .describe('IANA timezone (e.g., "America/New_York"). Defaults to UTC.'),
        }),
        execute: async (
          args: { startDate?: string; endDate?: string; timezone?: string },
          context: AIToolContext,
        ) => {
          return this.getAvailability(args, context);
        },
      },
      {
        name: 'create_event',
        description:
          'Create a new event on Google Calendar. Always include attendee email addresses when available so they receive a calendar invite. Always include a description with relevant context, agenda, or notes from the conversation so attendees know the purpose of the meeting. Returns event details including a link to the event.',
        inputSchema: z.object({
          title: z.string().describe('Event title/summary'),
          startTime: z
            .string()
            .describe('Start time in ISO 8601 format (e.g., "2024-03-15T14:00:00Z")'),
          endTime: z
            .string()
            .describe('End time in ISO 8601 format (e.g., "2024-03-15T15:00:00Z")'),
          description: z
            .string()
            .optional()
            .describe(
              'Event description/notes. Always include relevant context, agenda items, or a summary of what was discussed so attendees understand the purpose of the meeting.',
            ),
          attendees: z
            .array(z.string().email())
            .optional()
            .describe(
              'Email addresses of attendees. Always include attendee emails when known so they receive a calendar invite.',
            ),
          timezone: z
            .string()
            .optional()
            .describe('IANA timezone (e.g., "America/New_York"). Defaults to UTC.'),
        }),
        execute: async (
          args: {
            title: string;
            startTime: string;
            endTime: string;
            description?: string;
            attendees?: string[];
            timezone?: string;
          },
          context: AIToolContext,
        ) => {
          return this.createEvent(args, context);
        },
      },
    ];
  }

  private async getAvailability(
    args: { startDate?: string; endDate?: string; timezone?: string },
    context: AIToolContext,
  ): Promise<any> {
    try {
      const accessToken = await this.getAccessToken(context);
      const calendarId = (context.pipelineOptions?.calendarId as string) || 'primary';
      const lookAheadDays = (context.pipelineOptions?.lookAheadDays as number) || 7;
      const timezone = args.timezone || 'UTC';

      const now = new Date();
      const start = args.startDate ? new Date(args.startDate) : now;
      const end = args.endDate
        ? new Date(args.endDate)
        : new Date(start.getTime() + lookAheadDays * 24 * 60 * 60 * 1000);

      const response = await fetch(FREEBUSY_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
          timeZone: timezone,
          items: [{ id: calendarId }],
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        return {
          error: error.error?.message || `Calendar API returned HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      const busySlots = data.calendars?.[calendarId]?.busy || [];

      // Compute free slots from busy intervals
      let freeSlots = this.computeFreeSlots(busySlots, start.toISOString(), end.toISOString());

      // Truncate if maxSlots is configured
      const maxSlots = context.pipelineOptions?.maxSlots as number | undefined;
      if (maxSlots && freeSlots.length > maxSlots) {
        freeSlots = freeSlots.slice(0, maxSlots);
      }

      return { busySlots, freeSlots, timezone, calendarId };
    } catch (error) {
      return { error: `Failed to check availability: ${error.message}` };
    }
  }

  private async createEvent(
    args: {
      title: string;
      startTime: string;
      endTime: string;
      description?: string;
      attendees?: string[];
      timezone?: string;
    },
    context: AIToolContext,
  ): Promise<any> {
    try {
      const accessToken = await this.getAccessToken(context);
      const calendarId = (context.pipelineOptions?.calendarId as string) || 'primary';
      const timezone = args.timezone || 'UTC';

      const addGoogleMeet = context.pipelineOptions?.addGoogleMeet as boolean | undefined;

      const eventBody: any = {
        summary: args.title,
        start: { dateTime: args.startTime, timeZone: timezone },
        end: { dateTime: args.endTime, timeZone: timezone },
      };

      if (args.description) {
        eventBody.description = args.description;
      }

      const additionalAttendees =
        (context.pipelineOptions?.additionalAttendees as string[] | undefined) || [];
      const allAttendees = [
        ...(args.attendees || []),
        ...additionalAttendees.filter((email) => !args.attendees?.includes(email)),
      ];
      if (allAttendees.length) {
        eventBody.attendees = allAttendees.map((email) => ({ email }));
      }

      if (addGoogleMeet) {
        eventBody.conferenceData = {
          createRequest: {
            requestId: `meet-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        };
      }

      const eventsUrl = new URL(`${EVENTS_URL}/${encodeURIComponent(calendarId)}/events`);
      if (addGoogleMeet) {
        eventsUrl.searchParams.set('conferenceDataVersion', '1');
      }

      const response = await fetch(eventsUrl.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventBody),
      });

      if (!response.ok) {
        const error = await response.json();
        return {
          error: error.error?.message || `Calendar API returned HTTP ${response.status}`,
        };
      }

      const event = await response.json();

      const meetLink = event.conferenceData?.entryPoints?.find(
        (ep: any) => ep.entryPointType === 'video',
      )?.uri;

      return {
        event: {
          id: event.id,
          title: event.summary,
          start: event.start?.dateTime || event.start?.date,
          end: event.end?.dateTime || event.end?.date,
          attendees: event.attendees?.map((a: any) => a.email) || [],
          htmlLink: event.htmlLink,
          ...(meetLink && { meetLink }),
        },
      };
    } catch (error) {
      return { error: `Failed to create event: ${error.message}` };
    }
  }

  private async getAccessToken(context: AIToolContext): Promise<string> {
    return this.oauthService.getValidAccessToken(
      context.projectId,
      'google-calendar',
      context.pluginConfig,
    );
  }

  private computeFreeSlots(
    busySlots: Array<{ start: string; end: string }>,
    rangeStart: string,
    rangeEnd: string,
  ): Array<{ start: string; end: string }> {
    if (busySlots.length === 0) {
      return [{ start: rangeStart, end: rangeEnd }];
    }

    // Sort busy slots by start time
    const sorted = [...busySlots].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );

    const freeSlots: Array<{ start: string; end: string }> = [];
    let current = rangeStart;

    for (const busy of sorted) {
      if (new Date(busy.start).getTime() > new Date(current).getTime()) {
        freeSlots.push({ start: current, end: busy.start });
      }
      if (new Date(busy.end).getTime() > new Date(current).getTime()) {
        current = busy.end;
      }
    }

    if (new Date(current).getTime() < new Date(rangeEnd).getTime()) {
      freeSlots.push({ start: current, end: rangeEnd });
    }

    return freeSlots;
  }
}
