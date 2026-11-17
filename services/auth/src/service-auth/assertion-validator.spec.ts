import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { constants, generateKeyPairSync, sign } from 'node:crypto';
import { validateServiceAssertion } from './assertion-validator';

describe('validateServiceAssertion', () => {
  const marketplace = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const admin = generateKeyPairSync('rsa', { modulusLength: 2048 });

  const marketplaceIssuer = 'urn:gigzlk:local:bff:marketplace';
  const adminIssuer = 'urn:gigzlk:local:bff:admin';
  const audience = 'urn:gigzlk:local:auth-internal';
  const kid = 'shared-key-id';
  const jti = 'a'.repeat(32);
  const now = 1_000_000;

  const trustedIssuers = new Map([
    [
      marketplaceIssuer,
      {
        issuer: marketplaceIssuer,
        subject: 'marketplace-bff',
        audience,
        keys: new Map([[kid, marketplace.publicKey]]),
      },
    ],
    [
      adminIssuer,
      {
        issuer: adminIssuer,
        subject: 'admin-bff',
        audience,
        keys: new Map([[kid, admin.publicKey]]),
      },
    ],
  ]);

  function makeToken(
    issuer: string,
    subject: string,
    privateKey = marketplace.privateKey,
  ): string {
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');

    const header = encode({
      alg: 'RS256',
      typ: 'gigzlk-service-assertion+jwt',
      kid,
    });
    const payload = encode({
      iss: issuer,
      sub: subject,
      aud: audience,
      jti,
      iat: 1000,
      exp: 1060,
    });
    const input = `${header}.${payload}`;
    const signature = sign('sha256', Buffer.from(input, 'ascii'), {
      key: privateKey,
      padding: constants.RSA_PKCS1_PADDING,
    });

    return `${input}.${signature.toString('base64url')}`;
  }

  it('accepts a marketplace assertion signed with its own key', () => {
    const token = makeToken(marketplaceIssuer, 'marketplace-bff');

    expect(validateServiceAssertion(token, trustedIssuers, now)).toEqual({
      issuer: marketplaceIssuer,
      jti,
      issuedAt: 1000,
      expiresAt: 1060,
    });
  });

  it('rejects the marketplace key for an assertion claiming to be admin', () => {
    const token = makeToken(adminIssuer, 'admin-bff');

    expect(() => validateServiceAssertion(token, trustedIssuers, now)).toThrow(
      UnauthorizedException,
    );
  });

  it('accepts an admin assertion signed with its own key', () => {
    const token = makeToken(adminIssuer, 'admin-bff', admin.privateKey);

    expect(validateServiceAssertion(token, trustedIssuers, now).issuer).toBe(
      adminIssuer,
    );
  });

  it('fails closed when no trusted issuers are configured', () => {
    const token = makeToken(marketplaceIssuer, 'marketplace-bff');

    expect(() => validateServiceAssertion(token, new Map(), now)).toThrow(
      ServiceUnavailableException,
    );
  });
});
