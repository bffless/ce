import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { TrafficEvent } from './traffic-event.interface';

/**
 * In-process event bus for observed requests. The traffic observer middleware
 * publishes every finished request here; the SSE live-tail endpoint (and, in
 * later slices, the Request-log persister) subscribes. Events are ephemeral —
 * nothing is buffered or persisted in this service.
 */
@Injectable()
export class TrafficEventsService {
  private readonly events$ = new Subject<TrafficEvent>();

  emit(event: TrafficEvent): void {
    this.events$.next(event);
  }

  stream(): Observable<TrafficEvent> {
    return this.events$.asObservable();
  }
}
