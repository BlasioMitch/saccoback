// Only the gateway may call the REST API: it holds the internal key
import request from 'supertest';
import { app, as, useDatabase } from './support/helpers.js';

describe('API access', () => {
  useDatabase();

  it('refuses a request without the internal key', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('refuses a wrong key', async () => {
    const res = await request(app).get('/api/users').set('graph-api-key', 'not-the-key');
    expect(res.status).toBe(403);
  });

  it('lets the gateway in', async () => {
    const res = await as().get('/api/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('keeps the health check and sign-in public', async () => {
    expect((await request(app).get('/health')).body).toEqual({ status: 'ok' });
    expect((await request(app).post('/api/auth/login').send({ email: 'nobody@test.sacco', password: 'x' })).status).toBe(401);
  });
});
