import { UnauthorizedException } from '@nestjs/common';
import { ASSERTION_POLICY } from './assertion-policy';

export function validateAssertionTiming(
  issuedAt: unknown,
  expiresAt: unknown,
  nowMilliseconds: number = Date.now(),
): void {
  if (
    typeof issuedAt !== 'number' ||
    typeof expiresAt !== 'number' ||
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    issuedAt < 0 ||
    expiresAt < 0
  ) {
    invalid();
  }

  const now = nowMilliseconds / 1000;
  const lifetime = expiresAt - issuedAt;
  const leeway = ASSERTION_POLICY.clockLeewaySeconds;

  if (
    !Number.isFinite(now) ||
    lifetime <= 0 ||
    lifetime > ASSERTION_POLICY.maxLifetimeSeconds ||
    issuedAt > now + leeway ||
    now - issuedAt > ASSERTION_POLICY.maxAgeSeconds ||
    now >= expiresAt + leeway
  ) {
    invalid();
  }
}

function invalid(): never {
  throw new UnauthorizedException({
    code: 'SERVICE_AUTH_INVALID',
    message: 'Service authentication is invalid.',
  });
}
