import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { ExpressionInput } from './ExpressionInput';
import type { PreviousStep } from './AvailableVariables';

interface GoogleCalendarConfigProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  previousSteps: PreviousStep[];
}

export function GoogleCalendarConfig({ config, onChange, previousSteps }: GoogleCalendarConfigProps) {
  const action = (config.action as string) || 'freebusy';

  const calendarIdsValue = Array.isArray(config.calendarIds)
    ? (config.calendarIds as string[]).join(', ')
    : (config.calendarIds as string) || '';

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Action</Label>
        <Select
          value={action}
          onValueChange={(value) => onChange({ ...config, action: value })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="list_calendars">List Calendars</SelectItem>
            <SelectItem value="freebusy">Free/Busy</SelectItem>
            <SelectItem value="list_events">List Events</SelectItem>
            <SelectItem value="create_event">Create Event</SelectItem>
            <SelectItem value="update_event">Update Event</SelectItem>
            <SelectItem value="delete_event">Delete Event</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Requires the Google Calendar integration to be configured in Project Settings → Integrations.
        </p>
      </div>

      {action === 'freebusy' && (
        <>
          <div className="space-y-2">
            <Label>Calendar IDs *</Label>
            <ExpressionInput
              value={calendarIdsValue}
              onChange={(value) =>
                onChange({
                  ...config,
                  calendarIds: value.split(',').map((s: string) => s.trim()).filter(Boolean),
                })
              }
              placeholder="primary, steps.resource.google_calendar_id"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated calendar IDs (or single expression that resolves to one).
            </p>
          </div>
          <div className="space-y-2">
            <Label>Time Min *</Label>
            <ExpressionInput
              value={(config.timeMin as string) || ''}
              onChange={(value) => onChange({ ...config, timeMin: value })}
              placeholder="request.query.from"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">ISO 8601 start of window.</p>
          </div>
          <div className="space-y-2">
            <Label>Time Max *</Label>
            <ExpressionInput
              value={(config.timeMax as string) || ''}
              onChange={(value) => onChange({ ...config, timeMax: value })}
              placeholder="request.query.to"
              previousSteps={previousSteps}
            />
          </div>
          <div className="space-y-2">
            <Label>Timezone</Label>
            <Input
              value={(config.timezone as string) || ''}
              onChange={(e) => onChange({ ...config, timezone: e.target.value })}
              placeholder="America/New_York"
            />
            <p className="text-xs text-muted-foreground">IANA timezone (optional).</p>
          </div>
        </>
      )}

      {action === 'list_events' && (
        <>
          <div className="space-y-2">
            <Label>Calendar ID *</Label>
            <ExpressionInput
              value={(config.calendarId as string) || ''}
              onChange={(value) => onChange({ ...config, calendarId: value })}
              placeholder="primary"
              previousSteps={previousSteps}
            />
          </div>
          <div className="space-y-2">
            <Label>Time Min</Label>
            <ExpressionInput
              value={(config.timeMin as string) || ''}
              onChange={(value) => onChange({ ...config, timeMin: value })}
              placeholder="request.query.from"
              previousSteps={previousSteps}
            />
          </div>
          <div className="space-y-2">
            <Label>Time Max</Label>
            <ExpressionInput
              value={(config.timeMax as string) || ''}
              onChange={(value) => onChange({ ...config, timeMax: value })}
              placeholder="request.query.to"
              previousSteps={previousSteps}
            />
          </div>
          <div className="space-y-2">
            <Label>Max Results</Label>
            <Input
              type="number"
              value={(config.maxResults as number) || ''}
              onChange={(e) =>
                onChange({ ...config, maxResults: e.target.value ? Number(e.target.value) : undefined })
              }
              placeholder="250"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={config.singleEvents !== false}
              onCheckedChange={(checked) => onChange({ ...config, singleEvents: checked })}
            />
            <Label>Expand recurring events into instances</Label>
          </div>
          <div className="space-y-2">
            <Label>Order By</Label>
            <Select
              value={(config.orderBy as string) || 'startTime'}
              onValueChange={(value) => onChange({ ...config, orderBy: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="startTime">startTime</SelectItem>
                <SelectItem value="updated">updated</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {(action === 'create_event' || action === 'update_event') && (
        <>
          <div className="space-y-2">
            <Label>Calendar ID *</Label>
            <ExpressionInput
              value={(config.calendarId as string) || ''}
              onChange={(value) => onChange({ ...config, calendarId: value })}
              placeholder="steps.resource.google_calendar_id"
              previousSteps={previousSteps}
            />
          </div>

          {action === 'update_event' && (
            <div className="space-y-2">
              <Label>Event ID *</Label>
              <ExpressionInput
                value={(config.eventId as string) || ''}
                onChange={(value) => onChange({ ...config, eventId: value })}
                placeholder="steps.lookup.0.google_event_id"
                previousSteps={previousSteps}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>{action === 'create_event' ? 'Summary *' : 'Summary'}</Label>
            <ExpressionInput
              value={(config.summary as string) || ''}
              onChange={(value) => onChange({ ...config, summary: value })}
              placeholder="{{steps.service.name}} — {{steps.parse.customer_name}}"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Handlebars template (use {`{{...}}`} for interpolation).
            </p>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <ExpressionInput
              value={(config.description as string) || ''}
              onChange={(value) => onChange({ ...config, description: value })}
              placeholder="Notes: {{steps.parse.notes}}"
              previousSteps={previousSteps}
            />
          </div>

          <div className="space-y-2">
            <Label>Location</Label>
            <ExpressionInput
              value={(config.location as string) || ''}
              onChange={(value) => onChange({ ...config, location: value })}
              placeholder="123 Linden Ave, Asheville NC"
              previousSteps={previousSteps}
            />
          </div>

          <div className="space-y-2">
            <Label>{action === 'create_event' ? 'Start Time *' : 'Start Time'}</Label>
            <ExpressionInput
              value={(config.startTime as string) || ''}
              onChange={(value) => onChange({ ...config, startTime: value })}
              placeholder="steps.parse.starts_at"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">ISO 8601 expression.</p>
          </div>

          <div className="space-y-2">
            <Label>{action === 'create_event' ? 'End Time *' : 'End Time'}</Label>
            <ExpressionInput
              value={(config.endTime as string) || ''}
              onChange={(value) => onChange({ ...config, endTime: value })}
              placeholder="steps.parse.ends_at"
              previousSteps={previousSteps}
            />
          </div>

          <div className="space-y-2">
            <Label>Send Updates</Label>
            <Select
              value={(config.sendUpdates as string) || 'none'}
              onValueChange={(value) => onChange({ ...config, sendUpdates: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">none</SelectItem>
                <SelectItem value="all">all</SelectItem>
                <SelectItem value="externalOnly">externalOnly</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Whether Google notifies attendees by email.
            </p>
          </div>
        </>
      )}

      {action === 'delete_event' && (
        <>
          <div className="space-y-2">
            <Label>Calendar ID *</Label>
            <ExpressionInput
              value={(config.calendarId as string) || ''}
              onChange={(value) => onChange({ ...config, calendarId: value })}
              placeholder="steps.resource.google_calendar_id"
              previousSteps={previousSteps}
            />
          </div>
          <div className="space-y-2">
            <Label>Event ID *</Label>
            <ExpressionInput
              value={(config.eventId as string) || ''}
              onChange={(value) => onChange({ ...config, eventId: value })}
              placeholder="steps.lookup.0.google_event_id"
              previousSteps={previousSteps}
            />
          </div>
          <div className="space-y-2">
            <Label>Send Updates</Label>
            <Select
              value={(config.sendUpdates as string) || 'none'}
              onValueChange={(value) => onChange({ ...config, sendUpdates: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">none</SelectItem>
                <SelectItem value="all">all</SelectItem>
                <SelectItem value="externalOnly">externalOnly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      <div className="flex items-center gap-2 pt-2 border-t">
        <Switch
          checked={!!config.optional}
          onCheckedChange={(checked) => onChange({ ...config, optional: checked })}
        />
        <div>
          <Label>Optional (soft-fail)</Label>
          <p className="text-xs text-muted-foreground">
            When on, NOT_CONFIGURED / AUTH_FAILED / NOT_FOUND return success with{' '}
            <code>{`{ skipped: true, reason }`}</code> instead of erroring. Transient errors
            (rate-limit, 5xx) still surface.
          </p>
        </div>
      </div>
    </div>
  );
}
