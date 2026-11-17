import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { KeyObject } from 'node:crypto';
import {
  validateAssertionClaims,
  type ExpectedServiceIdentity,
} from './assertion-claims';
import { decodeCompactAssertion } from './assertion-compact';
import { validateAssertionHeader } from './assertion-header';
import { parseAssertionJson } from './assertion-json';
import { verifyAssertionSignature } from './assertion-signature';

export interface TrustedAssertionIssuer extends ExpectedServiceIdentity {
  keys: ReadonlyMap<string, KeyObject>;
}

export function validateServiceAssertion(
  token: string,
  trustedIssuers: ReadonlyMap<string, TrustedAssertionIssuer>,
  nowMilliseconds: number = Date.now(),
) {
  if (trustedIssuers.size === 0) {
    throw new ServiceUnavailableException({
      code: 'AUTH_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable.',
    });
  }

  const decoded = decodeCompactAssertion(token);
  const { kid } = validateAssertionHeader(
    parseAssertionJson(decoded.headerJson),
  );
  const claims = parseAssertionJson(decoded.payloadJson);

  const issuer =
    typeof claims.iss === 'string' ? trustedIssuers.get(claims.iss) : undefined;
  const key = issuer?.keys.get(kid);

  if (!issuer || !key) {
    throw new UnauthorizedException({
      code: 'SERVICE_AUTH_INVALID',
      message: 'Service authentication is invalid.',
    });
  }

  verifyAssertionSignature(decoded.signingInput, decoded.signature, key);

  return validateAssertionClaims(claims, issuer, nowMilliseconds);
}
