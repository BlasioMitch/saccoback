// Offline changes may arrive twice: the claim decision makes sure each one is applied once
import { decideClaim, isValidKey, STALE_AFTER_MS } from '../lib/idempotency.js';

const now = new Date('2026-10-10T10:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('decideClaim', () => {
  it('runs a key it has never seen', () => {
    expect(decideClaim(null, 'u1', now)).toEqual({ result: 'new' });
  });

  it('answers a finished key with its stored result instead of running it again', () => {
    expect(decideClaim({ userId: 'u1', status: 'DONE', updatedAt: ago(5_000) }, 'u1', now)).toEqual({ result: 'done' });
  });

  it('waits while another copy is running, and takes over one that never finished', () => {
    expect(decideClaim({ userId: 'u1', status: 'IN_PROGRESS', updatedAt: ago(10_000) }, 'u1', now)).toEqual({ result: 'in_progress' });
    expect(decideClaim({ userId: 'u1', status: 'IN_PROGRESS', updatedAt: ago(STALE_AFTER_MS + 1) }, 'u1', now)).toEqual({ result: 'new' });
  });

  it("never lets one user replay another user's key", () => {
    expect(decideClaim({ userId: 'u1', status: 'DONE', updatedAt: ago(1) }, 'u2', now)).toEqual({ result: 'forbidden' });
  });
});

describe('isValidKey', () => {
  it('accepts UUIDs and rejects junk', () => {
    expect(isValidKey('3f2b8c1e-9a4d-4c1b-8f0e-2d6a7b9c0e11')).toBe(true);
    expect(isValidKey('short')).toBe(false);
    expect(isValidKey("x'; drop table--")).toBe(false);
    expect(isValidKey(undefined)).toBe(false);
  });
});
