import { createHash } from 'node:crypto';
import {
  createVerificationToken,
  hashVerificationToken,
} from './verification-token';

describe('verification tokens', () => {
  it('generates a 32-byte token and its SHA-256 hash', () => {
    const result = createVerificationToken();

    expect(result.token).toMatch(/^[a-f0-9]{64}$/);
    expect(result.tokenHash).toBe(
      createHash('sha256').update(result.token).digest('hex'),
    );
    expect(result.tokenHash).not.toBe(result.token);
  });

  it('expires exactly 30 minutes after creation', () => {
    const now = new Date('2026-10-19T12:00:00.000Z');
    const result = createVerificationToken(now);

    expect(result.expiresAt.toISOString()).toBe('2026-10-19T12:30:00.000Z');
    expect(now.toISOString()).toBe('2026-10-19T12:00:00.000Z');
  });

  it('produces independently generated tokens', () => {
    expect(createVerificationToken().token).not.toBe(
      createVerificationToken().token,
    );
  });

  it('hashes the exact token without normalization', () => {
    expect(hashVerificationToken('abc')).not.toBe(hashVerificationToken('ABC'));
  });
});
