import { UnauthorizedException } from '@nestjs/common';
import { TextDecoder } from 'node:util';

export function decodeAssertionSegment(
  segment: string,
  maxBytes: number,
): string {
  try {
    if (
      segment.length === 0 ||
      segment.length > Math.ceil((maxBytes * 4) / 3) ||
      !/^[A-Za-z0-9_-]+$/.test(segment)
    ) {
      throw new Error();
    }

    const decoded = Buffer.from(segment, 'base64url');

    if (
      decoded.length > maxBytes ||
      decoded.toString('base64url') !== segment
    ) {
      throw new Error();
    }

    return new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(decoded);
  } catch {
    throw new UnauthorizedException({
      code: 'SERVICE_AUTH_INVALID',
      message: 'Service authentication is invalid.',
    });
  }
}
