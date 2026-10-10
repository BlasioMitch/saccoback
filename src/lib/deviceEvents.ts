// Sign-in events that happened on the phone while it couldn't reach the server (an offline sign-in, a wrong
// password typed offline, a sign-out without a connection). The phone keeps them and reports them once it is
// back online; they go into the audit trail with the time they really happened.

export const DEVICE_EVENT_ACTIONS = ['OFFLINE_LOGIN', 'OFFLINE_LOGIN_FAILED', 'LOGOUT'] as const;
export type DeviceEventAction = (typeof DEVICE_EVENT_ACTIONS)[number];

export const MAX_EVENTS_PER_REPORT = 50;
export const MAX_EVENT_AGE_DAYS = 30;
// Phone clocks drift a little
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export interface DeviceEvent {
  id: string;
  action: DeviceEventAction;
  email: string | null;
  userId: string | null;
  method: 'password' | 'fingerprint' | null;
  at: Date;
  deviceName: string | null;
  reason: string | null;
}

const text = (value: unknown, max: number) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Keeps the events that can be recorded; anything malformed, unknown, too old or in the future is dropped
export function validateDeviceEvents(input: unknown, now = new Date()): DeviceEvent[] {
  if (!Array.isArray(input)) return [];
  const oldest = now.getTime() - MAX_EVENT_AGE_DAYS * 24 * 60 * 60 * 1000;
  const newest = now.getTime() + FUTURE_TOLERANCE_MS;
  const events: DeviceEvent[] = [];
  for (const raw of input.slice(0, MAX_EVENTS_PER_REPORT)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const id = text(item.id, 64);
    const action = item.action as DeviceEventAction;
    const at = typeof item.at === 'string' ? new Date(item.at) : null;
    if (!id || !/^[A-Za-z0-9-]{16,64}$/.test(id)) continue;
    if (!DEVICE_EVENT_ACTIONS.includes(action)) continue;
    if (!at || Number.isNaN(at.getTime()) || at.getTime() < oldest || at.getTime() > newest) continue;
    const email = text(item.email, 255)?.toLowerCase() ?? null;
    const userId = text(item.userId, 36);
    if (!email && !userId) continue;
    events.push({
      id,
      action,
      email,
      userId: userId && UUID.test(userId) ? userId : null,
      method: item.method === 'password' || item.method === 'fingerprint' ? item.method : null,
      at,
      deviceName: text(item.deviceName, 100),
      reason: text(item.reason, 100),
    });
  }
  return events;
}

const by = (method: DeviceEvent['method']) => (method === 'fingerprint' ? ' with fingerprint' : method === 'password' ? ' with password' : '');

export function deviceEventSummary(event: Pick<DeviceEvent, 'action' | 'method' | 'reason'>) {
  switch (event.action) {
    case 'OFFLINE_LOGIN':
      return `Signed in${by(event.method)} while offline (checked on the phone)`;
    case 'OFFLINE_LOGIN_FAILED':
      return `${event.reason || 'Wrong password'} (offline, checked on the phone)`;
    case 'LOGOUT':
      return 'Signed out while offline';
  }
}
