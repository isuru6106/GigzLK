import { constants, sign } from 'node:crypto';
import type { AccessSigningKey } from './access-signing-key';
import {
  buildMarketplaceAccessClaims,
  type MarketplaceAccessClaimsInput,
} from './marketplace-access-claims';

export type SignedMarketplaceAccessToken = {
  accessToken: string;
  accessExpiresAt: Date;
};

export function signMarketplaceAccessToken(
  input: MarketplaceAccessClaimsInput,
  key: AccessSigningKey,
  nowMs: number = Date.now(),
): SignedMarketplaceAccessToken {
  try {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(key.kid) ||
      key.privateKey.type !== 'private' ||
      key.privateKey.asymmetricKeyType !== 'rsa' ||
      (key.privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    ) {
      throw new Error();
    }

    const claims = buildMarketplaceAccessClaims(input, nowMs);

    const headerJson = JSON.stringify({
      alg: 'RS256',
      typ: 'at+jwt',
      kid: key.kid,
    });

    const payloadJson = JSON.stringify(claims);

    if (
      Buffer.byteLength(headerJson, 'utf8') > 512 ||
      Buffer.byteLength(payloadJson, 'utf8') > 2048
    ) {
      throw new Error();
    }

    const header = Buffer.from(headerJson, 'utf8').toString('base64url');
    const payload = Buffer.from(payloadJson, 'utf8').toString('base64url');
    const signingInput = `${header}.${payload}`;

    const signature = sign('sha256', Buffer.from(signingInput, 'ascii'), {
      key: key.privateKey,
      padding: constants.RSA_PKCS1_PADDING,
    });

    const accessToken = `${signingInput}.${signature.toString('base64url')}`;

    if (Buffer.byteLength(accessToken, 'ascii') > 4096) {
      throw new Error();
    }

    return {
      accessToken,
      accessExpiresAt: new Date(claims.exp * 1000),
    };
  } catch {
    throw new Error('Unable to sign marketplace access token.');
  }
}
