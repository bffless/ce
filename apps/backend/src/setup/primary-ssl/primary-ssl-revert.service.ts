import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrimarySslSnapshotService } from './primary-ssl-snapshot.service';

@Injectable()
export class PrimarySslRevertService {
  private readonly logger = new Logger(PrimarySslRevertService.name);
  constructor(private readonly snap: PrimarySslSnapshotService) {}

  @Interval(15000)
  tick(): void {
    this.checkAndRevert(Date.now());
  }

  checkAndRevert(nowMs: number): void {
    const pending = this.snap.readPendingRevert();
    if (!pending) return;
    if (nowMs <= pending.deadlineMs) return;
    this.logger.warn('[primary-ssl] serving change unconfirmed past deadline — auto-reverting');
    try {
      this.snap.restore();
    } finally {
      this.snap.clearPendingRevert();
    }
  }
}
