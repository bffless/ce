import { InflightFuse } from './fuse';
import { RemoteBusyError } from './remote-errors';

describe('InflightFuse', () => {
  it('counts per name and blows at max', () => {
    const fuse = new InflightFuse();
    const r1 = fuse.acquire('a', 2);
    fuse.acquire('a', 2);
    expect(() => fuse.acquire('a', 2)).toThrow(RemoteBusyError);
    expect(fuse.inflight('a')).toBe(2);
    r1();
    expect(fuse.inflight('a')).toBe(1);
    expect(() => fuse.acquire('a', 2)).not.toThrow();
  });
  it('is independent per name and release is idempotent', () => {
    const fuse = new InflightFuse();
    const r = fuse.acquire('a', 1);
    expect(() => fuse.acquire('b', 1)).not.toThrow();
    r();
    r();
    expect(fuse.inflight('a')).toBe(0);
  });
});
