import { UnauthorizedException } from '@nestjs/common';
import { ASSERTION_POLICY } from './assertion-policy';
import { decodeAssertionSegment } from './assertion-segment';

export function decodeCompactAssertion(token: string) {
  if (
    token.length > ASSERTION_POLICY.maxEncodedBytes ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  ) {
    invalid();
  }

  const [header, payload, signature] = token.split('.');
  const signatureBytes = Buffer.from(signature, 'base64url');

  if (signatureBytes.toString('base64url') !== signature) {
    invalid();
  }

  return {
    headerJson: decodeAssertionSegment(header, ASSERTION_POLICY.maxHeaderBytes),
    payloadJson: decodeAssertionSegment(
      payload,
      ASSERTION_POLICY.maxPayloadBytes,
    ),
    signingInput: `${header}.${payload}`,
    signature: signatureBytes,
  };
}

function invalid(): never {
  throw new UnauthorizedException({
    code: 'SERVICE_AUTH_INVALID',
    message: 'Service authentication is invalid.',
  });
}
