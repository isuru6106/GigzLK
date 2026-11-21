import { randomBytes } from 'node:crypto';

const ACCESS_LIFETIME_SECONDS = 600;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MarketplaceAccessClaims = {
  iss: string;
  sub: string;
  aud: 'marketplace';
  sid: string;
  jti: string;
  iat: number;
  exp: number;
  auth_time: number;
  amr: ['pwd'];
};

export type MarketplaceAccessClaimsInput = {
  issuer: string;
  accountId: string;
  sessionId: string;
  sessionExpiresAt: Date;
  authenticatedAt: Date;
};

export function buildMarketplaceAccessClaims(
  input: MarketplaceAccessClaimsInput,
  nowMs: number = Date.now(),
): MarketplaceAccessClaims {
  const sessionExpiryMs = input.sessionExpiresAt.getTime();
  const authenticatedAtMs = input.authenticatedAt.getTime();

  if (
    input.issuer.length === 0 ||
    input.issuer.trim() !== input.issuer ||
    !UUID_PATTERN.test(input.accountId) ||
    !UUID_PATTERN.test(input.sessionId) ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    !Number.isSafeInteger(sessionExpiryMs) ||
    sessionExpiryMs < 0 ||
    !Number.isSafeInteger(authenticatedAtMs) ||
    authenticatedAtMs < 0 ||
    authenticatedAtMs > nowMs
  ) {
    throw new Error('Invalid marketplace access-token claim input.');
  }

  const issuedAt = Math.floor(nowMs / 1000);
  const sessionDeadline = Math.floor(sessionExpiryMs / 1000);
  const expiresAt = Math.min(
    issuedAt + ACCESS_LIFETIME_SECONDS,
    sessionDeadline,
  );

  if (expiresAt <= issuedAt) {
    throw new Error('Session has no remaining access-token lifetime.');
  }

  return {
    iss: input.issuer,
    sub: input.accountId,
    aud: 'marketplace',
    sid: input.sessionId,
    jti: randomBytes(16).toString('hex'),
    iat: issuedAt,
    exp: expiresAt,
    auth_time: Math.floor(authenticatedAtMs / 1000),
    amr: ['pwd'],
  };
}
