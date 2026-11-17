import { UnauthorizedException } from '@nestjs/common';
import { validateAssertionClaims } from './assertion-claims';

describe('validateAssertionClaims', () => {
  const expected = {
    issuer: 'urn:gigzlk:local:bff:marketplace',
    subject: 'marketplace-bff',
    audience: 'urn:gigzlk:local:auth-internal',
  };

  const valid = {
    iss: expected.issuer,
    sub: expected.subject,
    aud: expected.audience,
    jti: 'a'.repeat(32),
    iat: 1000,
    exp: 1060,
  };

  const check = (claims: Record<string, unknown>) =>
    validateAssertionClaims(claims, expected, 1000 * 1000);

  it('returns validated replay and timing metadata', () => {
    expect(check(valid)).toEqual({
      issuer: expected.issuer,
      jti: valid.jti,
      issuedAt: 1000,
      expiresAt: 1060,
    });
  });

  it.each([
    { iss: 'urn:gigzlk:local:bff:admin' },
    { sub: 'admin-bff' },
    { aud: 'marketplace' },
    { aud: [expected.audience] },
    { jti: 'A'.repeat(32) },
    { jti: 'a'.repeat(31) },
    { jti: 'a'.repeat(33) },
    { jti: 'g'.repeat(32) },
    { jti: 123 },
    { iat: '1000' },
    { exp: '1060' },
    { iat: null },
    { exp: null },
    { exp: 1061 },
    { exp: 995 },
    { iat: 1006, exp: 1066 },
  ])('rejects invalid claims: %j', (changes) => {
    expect(() => check({ ...valid, ...changes })).toThrow(
      UnauthorizedException,
    );
  });

  it.each(['iss', 'sub', 'aud', 'jti', 'iat', 'exp'])(
    'rejects a missing required claim: %s',
    (field) => {
      const claims: Record<string, unknown> = { ...valid };
      delete claims[field];

      expect(() => check(claims)).toThrow(UnauthorizedException);
    },
  );
});
