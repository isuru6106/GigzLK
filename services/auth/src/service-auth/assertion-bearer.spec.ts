import { UnauthorizedException } from '@nestjs/common';
import { extractServiceAssertion } from './assertion-bearer';

describe('extractServiceAssertion', () => {
  const token = 'AQ.AQ.AQ';

  it('extracts the token from one Authorization header', () => {
    expect(
      extractServiceAssertion([
        'Host',
        'localhost',
        'Authorization',
        `Bearer ${token}`,
      ]),
    ).toBe(token);
  });

  it('accepts case-insensitive header and scheme names', () => {
    expect(extractServiceAssertion(['aUtHoRiZaTiOn', `bEaReR ${token}`])).toBe(
      token,
    );
  });

  it('rejects duplicate Authorization headers regardless of casing', () => {
    expect(() =>
      extractServiceAssertion([
        'Authorization',
        `Bearer ${token}`,
        'authorization',
        `Bearer ${token}`,
      ]),
    ).toThrow(UnauthorizedException);
  });

  it.each([
    '',
    'Bearer',
    `Basic ${token}`,
    `Bearer  ${token}`,
    `Bearer\t${token}`,
    ` Bearer ${token}`,
    `Bearer ${token} `,
    `Bearer ${token}, Bearer ${token}`,
    'Bearer AQ.AQ',
    'Bearer AQ.AQ.AQ==',
  ])('rejects malformed credentials: %j', (value) => {
    expect(() => extractServiceAssertion(['Authorization', value])).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a missing Authorization header', () => {
    expect(() => extractServiceAssertion(['Host', 'localhost'])).toThrow(
      UnauthorizedException,
    );
  });

  it('accepts a token exactly at the encoded size limit', () => {
    const boundary = `${'A'.repeat(4090)}.AQ.AQ`;

    expect(boundary.length).toBe(4096);
    expect(
      extractServiceAssertion(['Authorization', `Bearer ${boundary}`]),
    ).toBe(boundary);
  });

  it('rejects a token above the encoded size limit', () => {
    const oversized = `${'A'.repeat(4091)}.AQ.AQ`;

    expect(() =>
      extractServiceAssertion(['Authorization', `Bearer ${oversized}`]),
    ).toThrow(UnauthorizedException);
  });
});
