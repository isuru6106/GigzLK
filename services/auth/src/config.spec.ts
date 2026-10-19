import { resolvePort } from './config';

describe('resolvePort', () => {
  it('defaults to the proposed Auth port', () => {
    expect(resolvePort(undefined)).toBe(3006);
  });

  it.each(['1', '3006', '65535'])('accepts valid port %s', (value) => {
    expect(resolvePort(value)).toBe(Number(value));
  });

  it.each(['', '0', '65536', '-1', '3.5', 'abc', '3006abc', ' '])(
    'rejects invalid port %j',
    (value) => {
      expect(() => resolvePort(value)).toThrow(
        'PORT must be an integer between 1 and 65535',
      );
    },
  );
});
