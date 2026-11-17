import { UnauthorizedException } from '@nestjs/common';
import { decodeCompactAssertion } from './assertion-compact';

describe('decodeCompactAssertion', () => {
  const encode = (text: string) => Buffer.from(text).toString('base64url');

  const header = encode('{"alg":"RS256"}');
  const payload = encode('{"iss":"test"}');
  const token = `${header}.${payload}.AQ`;

  it('decodes sections and preserves the exact signing input', () => {
    const result = decodeCompactAssertion(token);

    expect(result.headerJson).toBe('{"alg":"RS256"}');
    expect(result.payloadJson).toBe('{"iss":"test"}');
    expect(result.signingInput).toBe(`${header}.${payload}`);
    expect(result.signature).toEqual(Buffer.from([1]));
  });

  it.each([
    '',
    'AQ',
    'AQ.AQ',
    'AQ.AQ.AQ.AQ',
    '.AQ.AQ',
    'AQ..AQ',
    'AQ.AQ.',
    'AQ.AQ.AQ==',
    'AQ.AQ.A+',
    'AQ.AQ.A',
    'AQ.AQ.AR',
    ` ${token}`,
    `${token}\n`,
    `Bearer ${token}`,
  ])('rejects malformed compact input: %j', (input) => {
    expect(() => decodeCompactAssertion(input)).toThrow(UnauthorizedException);
  });

  it('rejects a JWT above 4096 bytes', () => {
    const oversized = `${header}.${payload}.${'A'.repeat(4096)}`;

    expect(() => decodeCompactAssertion(oversized)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a decoded header above 512 bytes', () => {
    const oversized = `${encode('a'.repeat(513))}.${payload}.AQ`;

    expect(() => decodeCompactAssertion(oversized)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a decoded payload above 2048 bytes', () => {
    const oversized = `${header}.${encode('a'.repeat(2049))}.AQ`;

    expect(() => decodeCompactAssertion(oversized)).toThrow(
      UnauthorizedException,
    );
  });
});
