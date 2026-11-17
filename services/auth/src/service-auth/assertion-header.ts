import { UnauthorizedException } from '@nestjs/common';
import { ASSERTION_KID_PATTERN, ASSERTION_POLICY } from './assertion-policy';

export function validateAssertionHeader(header: Record<string, unknown>): {
  kid: string;
} {
  const allowedFields = new Set(['alg', 'typ', 'kid']);

  if (
    Object.keys(header).some((field) => !allowedFields.has(field)) ||
    header.alg !== ASSERTION_POLICY.algorithm ||
    header.typ !== ASSERTION_POLICY.tokenType ||
    typeof header.kid !== 'string' ||
    !ASSERTION_KID_PATTERN.test(header.kid)
  ) {
    throw new UnauthorizedException({
      code: 'SERVICE_AUTH_INVALID',
      message: 'Service authentication is invalid.',
    });
  }

  return { kid: header.kid };
}
