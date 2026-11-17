import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { constants, generateKeyPairSync, sign } from 'node:crypto';
import { verifyAssertionSignature } from './assertion-signature';

describe('verifyAssertionSignature', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const { publicKey: otherPublicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const signingInput = 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ0ZXN0In0';
  const signature = sign('sha256', Buffer.from(signingInput, 'ascii'), {
    key: privateKey,
    padding: constants.RSA_PKCS1_PADDING,
  });

  it('accepts a valid signature from the configured key', () => {
    expect(() =>
      verifyAssertionSignature(signingInput, signature, publicKey),
    ).not.toThrow();
  });

  it('rejects a changed payload', () => {
    const changed = 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJvdGhlciJ9';

    expect(() =>
      verifyAssertionSignature(changed, signature, publicKey),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a signature checked with the wrong RSA key', () => {
    expect(() =>
      verifyAssertionSignature(signingInput, signature, otherPublicKey),
    ).toThrow(UnauthorizedException);
  });

  it('treats a private key supplied to the verifier as a configuration error', () => {
    expect(() =>
      verifyAssertionSignature(signingInput, signature, privateKey),
    ).toThrow(ServiceUnavailableException);
  });
});
