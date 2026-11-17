import { UnauthorizedException } from '@nestjs/common';
import { validateAssertionHeader } from './assertion-header';

describe('validateAssertionHeader', () => {
  const valid = {
    alg: 'RS256',
    typ: 'gigzlk-service-assertion+jwt',
    kid: 'marketplace-2026.01',
  };

  it('accepts the agreed header', () => {
    expect(validateAssertionHeader(valid)).toEqual({
      kid: valid.kid,
    });
  });

  it('accepts a 64-character key identifier', () => {
    expect(() =>
      validateAssertionHeader({ ...valid, kid: 'a'.repeat(64) }),
    ).not.toThrow();
  });

  it.each([
    { alg: 'HS256' },
    { alg: 'none' },
    { typ: 'JWT' },
    { kid: '' },
    { kid: 'a'.repeat(65) },
    { kid: '../key' },
    { kid: '-key' },
    { kid: 'key name' },
    { kid: 123 },
    { kid: null },
    { kid: 'clé' },
    { jwk: {} },
    { jku: 'https://example.invalid/keys' },
    { x5u: 'https://example.invalid/cert' },
    { crit: [] },
    { extra: true },
  ])('rejects invalid or unsupported headers: %j', (changes) => {
    expect(() => validateAssertionHeader({ ...valid, ...changes })).toThrow(
      UnauthorizedException,
    );
  });

  it.each(['alg', 'typ', 'kid'])(
    'rejects a missing required field: %s',
    (field) => {
      const header: Record<string, unknown> = { ...valid };
      delete header[field];

      expect(() => validateAssertionHeader(header)).toThrow(
        UnauthorizedException,
      );
    },
  );
});
