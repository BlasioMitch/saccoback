// Passkey challenges travel in signed tokens: only the right kind, unexpired and untampered, is accepted
import jwt from 'jsonwebtoken';
import { readPasskeyChallenge, signPasskeyChallenge } from '../services/passkeys.js';

describe('passkey challenges', () => {
  it('reads back a challenge of the same kind', () => {
    const token = signPasskeyChallenge('abc123', 'passkey-reg', 'user-1');
    expect(readPasskeyChallenge(token, 'passkey-reg')).toEqual({ challenge: 'abc123', userId: 'user-1' });
  });

  it('refuses a challenge of the other kind, a tampered one, or an expired one', () => {
    const token = signPasskeyChallenge('abc123', 'passkey-auth');
    expect(() => readPasskeyChallenge(token, 'passkey-reg')).toThrow(/expired/);
    expect(() => readPasskeyChallenge(`${token}x`, 'passkey-auth')).toThrow(/expired/);
    const expired = jwt.sign({ challenge: 'abc', purpose: 'passkey-auth', exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET || 'my-secret-key');
    expect(() => readPasskeyChallenge(expired, 'passkey-auth')).toThrow(/expired/);
  });
});
