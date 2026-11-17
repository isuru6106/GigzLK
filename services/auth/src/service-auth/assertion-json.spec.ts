import { UnauthorizedException } from '@nestjs/common';
import { parseAssertionJson } from './assertion-json';

describe('parseAssertionJson', () => {
  it('accepts the same field name in separate objects', () => {
    expect(parseAssertionJson('{"a":{"id":1},"b":{"id":2}}')).toEqual({
      a: { id: 1 },
      b: { id: 2 },
    });
  });

  it.each([
    '{"iss":"first","iss":"second"}',
    String.raw`{"iss":"first","\u0069ss":"second"}`,
    '{"items":[{"id":1,"id":2}]}',
    '{"iss":"first",}',
    '{"iss":/* comment */"first"}',
    '[]',
    'null',
    '"text"',
  ])('rejects invalid assertion JSON: %j', (input) => {
    expect(() => parseAssertionJson(input)).toThrow(UnauthorizedException);
  });

  it('rejects JSON above the byte limit', () => {
    const input = JSON.stringify({ value: 'é'.repeat(1024) });

    expect(() => parseAssertionJson(input)).toThrow(UnauthorizedException);
  });
});
