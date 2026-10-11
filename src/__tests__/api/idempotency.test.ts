// The gateway claims a key before running a replayed offline change, so it is applied only once
import { as, makeUser, sequelize, useDatabase } from './support/helpers.js';

describe('idempotency keys', () => {
  useDatabase();

  const KEY = 'bbbbbbbb-2222-4222-8222-000000000001';

  it('claims a new key, then answers later copies with the stored result', async () => {
    const { actor } = await makeUser();
    const claim = () => as(actor).post('/api/idempotency/claim', { key: KEY, operation: 'CreateTransaction' });
    expect((await claim()).body).toEqual({ status: 'new' });
    expect((await claim()).body).toEqual({ status: 'in_progress' });
    await as(actor).post('/api/idempotency/complete', { key: KEY, response: { data: { ok: 1 } } });
    expect((await claim()).body).toEqual({ status: 'done', response: { data: { ok: 1 } } });
  });

  it('a released key can run again (the change failed)', async () => {
    const { actor } = await makeUser();
    await as(actor).post('/api/idempotency/claim', { key: KEY });
    await as(actor).post('/api/idempotency/release', { key: KEY });
    expect((await as(actor).post('/api/idempotency/claim', { key: KEY })).body).toEqual({ status: 'new' });
  });

  it('takes over a claim that was left unfinished', async () => {
    const { actor } = await makeUser();
    await as(actor).post('/api/idempotency/claim', { key: KEY });
    await sequelize.query(`UPDATE idempotency_keys SET "updatedAt" = now() - interval '10 minutes' WHERE key = :key`, { replacements: { key: KEY } });
    expect((await as(actor).post('/api/idempotency/claim', { key: KEY })).body).toEqual({ status: 'new' });
  });

  it("refuses another member's key and malformed keys", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    await as(owner.actor).post('/api/idempotency/claim', { key: KEY });
    expect((await as(other.actor).post('/api/idempotency/claim', { key: KEY })).status).toBe(403);
    expect((await as(owner.actor).post('/api/idempotency/claim', { key: 'short' })).status).toBe(400);
  });
});
