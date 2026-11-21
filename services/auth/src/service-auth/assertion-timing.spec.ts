import { UnauthorizedException } from '@nestjs/common';
import { validateAssertionTiming } from './assertion-timing';

describe('validateAssertionTiming', () => {
  const now = 1000;
  const check = (iat: unknown, exp: unknown, time = now) =>
    validateAssertionTiming(iat, exp, time * 1000);

  it('accepts a valid 60-second assertion', () => {
    expect(() => check(1000, 1060)).not.toThrow();
  });

  it('accepts issued-at exactly five seconds ahead', () => {
    expect(() => check(1005, 1065)).not.toThrow();
  });

  it('rejects issued-at beyond the allowed leeway', () => {
    expect(() => check(1006, 1066)).toThrow(UnauthorizedException);
  });

  it('accepts immediately before the final expiry boundary', () => {
    expect(() => check(940, 1000, 1004.999)).not.toThrow();
  });

  it('rejects exactly at the final expiry boundary', () => {
    expect(() => check(940, 1000, 1005)).toThrow(UnauthorizedException);
  });

  it.each([
    [1000, 1000],
    [1000, 999],
    [1000, 1061],
    [1000.5, 1060],
    [1000, 1060.5],
    ['1000', 1060],
    [1000, null],
    [-1, 59],
    [NaN, 1060],
    [1000, Infinity],
    [Number.MAX_SAFE_INTEGER + 1, 1060],
  ])('rejects invalid timestamps (%s, %s)', (iat, exp) => {
    expect(() => check(iat, exp)).toThrow(UnauthorizedException);
  });

  it('rechecks time after a database wait', () => {
    expect(() => check(1000, 1060, 1064)).not.toThrow();
    expect(() => check(1000, 1060, 1065)).toThrow(UnauthorizedException);
  });

  it('returns a safe authentication error', () => {
    try {
      check(1000, 1000);
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toEqual({
        code: 'SERVICE_AUTH_INVALID',
        message: 'Service authentication is invalid.',
      });
    }
  });
});
