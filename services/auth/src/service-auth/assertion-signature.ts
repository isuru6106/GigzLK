import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { constants, type KeyObject, verify } from 'node:crypto';

export function verifyAssertionSignature(
  signingInput: string,
  signature: Buffer,
  publicKey: KeyObject,
): void {
  const modulusLength = publicKey.asymmetricKeyDetails?.modulusLength;

  if (
    publicKey.type !== 'public' ||
    publicKey.asymmetricKeyType !== 'rsa' ||
    modulusLength === undefined ||
    modulusLength < 2048
  ) {
    unavailable();
  }

  let valid: boolean;
  try {
    valid = verify(
      'sha256',
      Buffer.from(signingInput, 'ascii'),
      { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
      signature,
    );
  } catch {
    unavailable();
  }

  if (!valid) {
    throw new UnauthorizedException({
      code: 'SERVICE_AUTH_INVALID',
      message: 'Service authentication is invalid.',
    });
  }
}

function unavailable(): never {
  throw new ServiceUnavailableException({
    code: 'AUTH_UNAVAILABLE',
    message: 'Authentication is temporarily unavailable.',
  });
}
