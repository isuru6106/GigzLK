import { UnauthorizedException } from '@nestjs/common';
import { decodeAssertionSegment } from './assertion-segment';

describe('decodeAssertionSegment', () => {
  const encode = (text: string) =>
    Buffer.from(text, 'utf8').toString('base64url');

  it('decodes valid UTF-8', () => {
    const text = '{"name":"worker"}';
    expect(decodeAssertionSegment(encode(text), 512)).toBe(text);
  });

  it('accepts exactly the decoded byte limit', () => {
    expect(decodeAssertionSegment(encode('abc'), 3)).toBe('abc');
  });

  it('rejects decoded content above the limit', () => {
    expect(() => decodeAssertionSegment(encode('abcd'), 3)).toThrow(
      UnauthorizedException,
    );
  });

  it('measures bytes rather than characters', () => {
    expect(decodeAssertionSegment(encode('é'), 2)).toBe('é');
    expect(() => decodeAssertionSegment(encode('é'), 1)).toThrow(
      UnauthorizedException,
    );
  });

  it.each(['', 'YQ==', 'YQ+', 'YQ/', 'Y Q', 'YQ\n', 'A', 'YR'])(
    'rejects malformed or noncanonical encoding: %j',
    (segment) => {
      expect(() => decodeAssertionSegment(segment, 512)).toThrow(
        UnauthorizedException,
      );
    },
  );

  it('rejects invalid UTF-8', () => {
    const segment = Buffer.from([0xc3, 0x28]).toString('base64url');

    expect(() => decodeAssertionSegment(segment, 512)).toThrow(
      UnauthorizedException,
    );
  });
});
