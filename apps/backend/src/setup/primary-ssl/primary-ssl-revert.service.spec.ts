import { PrimarySslRevertService } from './primary-ssl-revert.service';

const makeSnap = (pending: any) => ({
  readPendingRevert: jest.fn().mockReturnValue(pending),
  restore: jest.fn(),
  clearPendingRevert: jest.fn(),
});

describe('PrimarySslRevertService', () => {
  it('reverts when the deadline has passed', () => {
    const snap = makeSnap({ deadlineMs: 1000, appliedAt: 0 });
    new PrimarySslRevertService(snap as any).checkAndRevert(2000);
    expect(snap.restore).toHaveBeenCalled();
    expect(snap.clearPendingRevert).toHaveBeenCalled();
  });
  it('does nothing before the deadline', () => {
    const snap = makeSnap({ deadlineMs: 5000, appliedAt: 0 });
    new PrimarySslRevertService(snap as any).checkAndRevert(2000);
    expect(snap.restore).not.toHaveBeenCalled();
  });
  it('does nothing when there is no pending revert', () => {
    const snap = makeSnap(null);
    new PrimarySslRevertService(snap as any).checkAndRevert(2000);
    expect(snap.restore).not.toHaveBeenCalled();
  });
});
