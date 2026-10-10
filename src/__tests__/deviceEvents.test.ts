// Sign-in events the phone kept while offline: only well-formed, known and recent ones are recorded
import { deviceEventSummary, MAX_EVENTS_PER_REPORT, validateDeviceEvents } from '../lib/deviceEvents.js';

const now = new Date('2026-10-10T10:00:00Z');
const event = (overrides: Record<string, unknown> = {}) => ({
  id: '6f1c2a7e-4b0d-4c55-9a1e-2f9d8b7c6a51',
  action: 'OFFLINE_LOGIN_FAILED',
  email: ' LNami@Example.com ',
  method: 'password',
  at: '2026-10-10T09:30:00Z',
  deviceName: 'Sony XQ-DQ72',
  ...overrides,
});

describe('validateDeviceEvents', () => {
  it('keeps a well-formed event, with the email normalised', () => {
    const [kept] = validateDeviceEvents([event()], now);
    expect(kept).toMatchObject({ action: 'OFFLINE_LOGIN_FAILED', email: 'lnami@example.com', method: 'password', deviceName: 'Sony XQ-DQ72' });
    expect(kept.at.toISOString()).toBe('2026-10-10T09:30:00.000Z');
  });

  it('drops unknown actions, bad ids and events about nobody', () => {
    expect(validateDeviceEvents([
      event({ action: 'USER_DELETE' }),
      event({ id: 'short' }),
      event({ email: null, userId: null }),
      'not an object',
    ], now)).toEqual([]);
  });

  it('drops events older than 30 days or from the future', () => {
    expect(validateDeviceEvents([event({ at: '2026-09-01T00:00:00Z' })], now)).toEqual([]);
    expect(validateDeviceEvents([event({ at: '2026-10-10T11:00:00Z' })], now)).toEqual([]);
    // A few minutes of clock drift is fine
    expect(validateDeviceEvents([event({ at: '2026-10-10T10:03:00Z' })], now)).toHaveLength(1);
  });

  it('records at most 50 per report', () => {
    const many = Array.from({ length: 80 }, (_, index) => event({ id: `6f1c2a7e-4b0d-4c55-9a1e-${String(index).padStart(12, '0')}` }));
    expect(validateDeviceEvents(many, now)).toHaveLength(MAX_EVENTS_PER_REPORT);
  });

  it('ignores a userId that is not a uuid but keeps the email', () => {
    const [kept] = validateDeviceEvents([event({ userId: 'abc' })], now);
    expect(kept.userId).toBeNull();
    expect(kept.email).toBe('lnami@example.com');
  });
});

describe('deviceEventSummary', () => {
  it('says what happened and that it happened offline', () => {
    expect(deviceEventSummary({ action: 'OFFLINE_LOGIN', method: 'fingerprint', reason: null }))
      .toBe('Signed in with fingerprint while offline (checked on the phone)');
    expect(deviceEventSummary({ action: 'OFFLINE_LOGIN_FAILED', method: 'password', reason: null }))
      .toBe('Wrong password (offline, checked on the phone)');
    expect(deviceEventSummary({ action: 'OFFLINE_LOGIN_FAILED', method: 'password', reason: 'Offline sign-in locked after 5 wrong passwords' }))
      .toMatch(/^Offline sign-in locked/);
    expect(deviceEventSummary({ action: 'LOGOUT', method: null, reason: null })).toBe('Signed out while offline');
  });
});
