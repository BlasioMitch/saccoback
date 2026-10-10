// Offline changes are sent again until the app hears back, so the same change can arrive twice.
// Each one carries a client-made key; the gateway asks here before running it.

export type KeyStatus = 'IN_PROGRESS' | 'DONE';

export interface StoredKey {
  userId: string | null;
  status: KeyStatus;
  updatedAt: Date;
}

export type ClaimDecision =
  | { result: 'new' }          // run it
  | { result: 'done' }         // already applied: answer with the stored response
  | { result: 'in_progress' }  // another copy is running right now
  | { result: 'forbidden' };   // someone else's key

// A copy that started but never finished (the gateway restarted mid-way) can be retried after this
export const STALE_AFTER_MS = 2 * 60 * 1000;
export const KEEP_FOR_DAYS = 7;

export function decideClaim(existing: StoredKey | null, userId: string | null, now = new Date()): ClaimDecision {
  if (!existing) return { result: 'new' };
  if (existing.userId && userId && existing.userId !== userId) return { result: 'forbidden' };
  if (existing.status === 'DONE') return { result: 'done' };
  return now.getTime() - existing.updatedAt.getTime() > STALE_AFTER_MS ? { result: 'new' } : { result: 'in_progress' };
}

export const isValidKey = (key: unknown): key is string => typeof key === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(key);
