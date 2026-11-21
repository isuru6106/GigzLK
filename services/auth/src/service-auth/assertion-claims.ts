import { UnauthorizedException } from '@nestjs/common';
import { ASSERTION_JTI_PATTERN } from './assertion-policy';
import { validateAssertionTiming } from './assertion-timing';

export interface ExpectedServiceIdentity {
  issuer: string;
  subject: string;
  audience: string;
}

export interface ValidatedAssertionClaims {
  issuer: string;
  jti: string;
  issuedAt: number;
  expiresAt: number;
}

export function validateAssertionClaims(
  claims: Record<string, unknown>,
  expected: ExpectedServiceIdentity,
  nowMilliseconds: number = Date.now(),
): ValidatedAssertionClaims {
  if (
    claims.iss !== expected.issuer ||
    claims.sub !== expected.subject ||
    claims.aud !== expected.audience ||
    typeof claims.jti !== 'string' ||
    !ASSERTION_JTI_PATTERN.test(claims.jti) ||
    typeof claims.iat !== 'number' ||
    typeof claims.exp !== 'number'
  ) {
    throw new UnauthorizedException({
      code: 'SERVICE_AUTH_INVALID',
      message: 'Service authentication is invalid.',
    });
  }

  validateAssertionTiming(claims.iat, claims.exp, nowMilliseconds);

  return {
    issuer: expected.issuer,
    jti: claims.jti,
    issuedAt: claims.iat,
    expiresAt: claims.exp,
  };
}
