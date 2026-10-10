// What the audit trail stores: the action each route is recorded as, and never a secret
import { matchRoute, redact } from '../lib/audit.js';

describe('matchRoute', () => {
  it.each([
    ['POST', '/api/loans/abc-123/approve', 'LOAN_APPROVE', 'abc-123'],
    ['POST', '/api/loans/applications', 'LOAN_APPLY', null],
    ['POST', '/api/loans', 'LOAN_CREATE', null],
    ['PATCH', '/api/users/u-1', 'USER_UPDATE', 'u-1'],
    ['POST', '/api/users/u-1/password/initial', 'PASSWORD_CHANGED', 'u-1'],
    ['POST', '/api/password-resets/r-9/complete', 'PASSWORD_RESET_ISSUED', 'r-9'],
    ['DELETE', '/api/transactions/t-5', 'TRANSACTION_DELETE', 't-5'],
    ['POST', '/api/transactions/bulk', 'TRANSACTION_BULK_IMPORT', null],
  ])('%s %s is %s', (method, path, action, entityId) => {
    expect(matchRoute(method, path)).toMatchObject({ action: { action }, entityId });
  });

  it('skips routes that change nothing worth auditing, and unknown routes', () => {
    expect(matchRoute('POST', '/api/users/u-1/notifications/read')).toBeNull();
    expect(matchRoute('GET', '/api/loans')).toBeNull();
    expect(matchRoute('POST', '/api/somewhere/else')).toBeNull();
  });
});

describe('redact', () => {
  it('removes passwords, codes, tokens and images', () => {
    expect(redact({
      email: 'a@b.c', password: 'Secret123', newPassword: 'x', code: '123456', challengeToken: 'jwt', avatar: 'data:image/jpeg;base64,AAAA',
    })).toEqual({
      email: 'a@b.c', password: '[redacted]', newPassword: '[redacted]', code: '[redacted]', challengeToken: '[redacted]', avatar: '[image]',
    });
  });

  it('summarises lists, shortens long text and limits depth', () => {
    const result = redact({ rows: [1, 2, 3], note: 'x'.repeat(400), deep: { a: { b: { c: { d: 1 } } } } }) as any;
    expect(result.rows).toBe('[3 items]');
    expect(result.note.length).toBeLessThan(310);
    expect(result.deep.a.b).toBe('[object]');
  });
});
