import {
  buildMarketplaceAccessClaims,
  type MarketplaceAccessClaimsInput,
} from './marketplace-access-claims';

describe('buildMarketplaceAccessClaims', () => {
  const nowMs = Date.parse('2026-11-20T10:00:00.750Z');

  function input(): MarketplaceAccessClaimsInput {
    return {
      issuer: 'urn:gigzlk:local:auth',
      accountId: 'b5718a95-f11f-4cfe-91dc-55d595af8dbc',
      sessionId: 'ddce7093-c348-401a-a59e-1493fcbebdeb',
      sessionExpiresAt: new Date(nowMs + 7 * 24 * 60 * 60 * 1000),
      authenticatedAt: new Date(nowMs - 60_000),
    };
  }

  it('builds the agreed claims with a ten-minute maximum', () => {
    const source = input();
    const claims = buildMarketplaceAccessClaims(source, nowMs);

    expect(claims).toEqual({
      iss: source.issuer,
      sub: source.accountId,
      aud: 'marketplace',
      sid: source.sessionId,
      jti: claims.jti,
      iat: Math.floor(nowMs / 1000),
      exp: Math.floor(nowMs / 1000) + 600,
      auth_time: Math.floor(source.authenticatedAt.getTime() / 1000),
      amr: ['pwd'],
    });

    expect(claims.jti).toMatch(/^[0-9a-f]{32}$/);
  });

  it('caps expiry at the session deadline rounded down', () => {
    const source = input();
    source.sessionExpiresAt = new Date(nowMs + 30_123);

    const claims = buildMarketplaceAccessClaims(source, nowMs);

    expect(claims.exp).toBe(
      Math.floor(source.sessionExpiresAt.getTime() / 1000),
    );
    expect(claims.exp * 1000).toBeLessThanOrEqual(
      source.sessionExpiresAt.getTime(),
    );
  });

  it('accepts exactly one remaining whole second', () => {
    const source = input();
    source.sessionExpiresAt = new Date((Math.floor(nowMs / 1000) + 1) * 1000);

    const claims = buildMarketplaceAccessClaims(source, nowMs);

    expect(claims.exp - claims.iat).toBe(1);
  });

  it.each([
    ['expired', nowMs - 1],
    ['at current time', nowMs],
    ['within the current second', nowMs + 100],
  ])('rejects a session %s', (_label, expiryMs) => {
    const source = input();
    source.sessionExpiresAt = new Date(expiryMs);

    expect(() => buildMarketplaceAccessClaims(source, nowMs)).toThrow(
      'Session has no remaining access-token lifetime.',
    );
  });

  it('preserves authentication time across later claim construction', () => {
    const source = input();
    const originalAuthenticationTime = source.authenticatedAt.getTime();

    const first = buildMarketplaceAccessClaims(source, nowMs);
    const later = buildMarketplaceAccessClaims(source, nowMs + 60_000);

    expect(later.iat).toBe(first.iat + 60);
    expect(later.auth_time).toBe(first.auth_time);
    expect(source.authenticatedAt.getTime()).toBe(originalAuthenticationTime);
  });

  it('generates a fresh identifier for each token', () => {
    const first = buildMarketplaceAccessClaims(input(), nowMs);
    const second = buildMarketplaceAccessClaims(input(), nowMs);

    expect(first.jti).toMatch(/^[0-9a-f]{32}$/);
    expect(second.jti).toMatch(/^[0-9a-f]{32}$/);
    expect(first.jti).not.toBe(second.jti);
  });

  it.each([
    { issuer: '' },
    { issuer: ' urn:gigzlk:local:auth' },
    { issuer: 'urn:gigzlk:local:auth ' },
    { accountId: 'invalid-account' },
    { sessionId: 'invalid-session' },
    { sessionExpiresAt: new Date(NaN) },
    { authenticatedAt: new Date(NaN) },
    { authenticatedAt: new Date(-1) },
    { authenticatedAt: new Date(nowMs + 1) },
  ])('rejects invalid input: %p', (changes) => {
    expect(() =>
      buildMarketplaceAccessClaims({ ...input(), ...changes }, nowMs),
    ).toThrow('Invalid marketplace access-token claim input.');
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid current time: %p',
    (invalidNow) => {
      expect(() => buildMarketplaceAccessClaims(input(), invalidNow)).toThrow(
        'Invalid marketplace access-token claim input.',
      );
    },
  );
});
