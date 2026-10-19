import { createHash, randomBytes } from 'node:crypto';

export const VERIFICATION_TOKEN_TTL_MS = 30 * 60 * 1000;

export function hashVerificationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createVerificationToken(now = new Date()) {
  const token = randomBytes(32).toString('hex');

  return {
    token,
    tokenHash: hashVerificationToken(token),
    expiresAt: new Date(now.getTime() + VERIFICATION_TOKEN_TTL_MS),
  };
}
