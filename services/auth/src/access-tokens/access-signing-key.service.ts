import { Injectable } from '@nestjs/common';
import type { AccessSigningKey } from './access-signing-key';
import { loadAccessSigningKey } from './access-signing-key-config';
import type { MarketplaceAccessClaimsInput } from './marketplace-access-claims';
import {
  signMarketplaceAccessToken,
  type SignedMarketplaceAccessToken,
} from './sign-marketplace-access-token';

@Injectable()
export class AccessSigningKeyService {
  private readonly signingKey: AccessSigningKey | undefined;

  constructor() {
    const config = {
      kid: process.env.AUTH_ACCESS_SIGNING_KID,
      privateKeyFile: process.env.AUTH_ACCESS_PRIVATE_KEY_FILE,
      publicKeyFile: process.env.AUTH_ACCESS_PUBLIC_KEY_FILE,
    };

    const isConfigured = Object.values(config).some(
      (value) => value !== undefined,
    );

    this.signingKey = isConfigured ? loadAccessSigningKey(config) : undefined;
  }

  getPublicJwks() {
    if (!this.signingKey) {
      throw new Error('Access-token discovery is unavailable.');
    }

    const publicJwk = this.signingKey.publicKey.export({ format: 'jwk' });

    if (
      publicJwk.kty !== 'RSA' ||
      typeof publicJwk.n !== 'string' ||
      typeof publicJwk.e !== 'string'
    ) {
      throw new Error('Access-token discovery is unavailable.');
    }

    return {
      keys: [
        {
          kty: 'RSA',
          use: 'sig',
          alg: 'RS256',
          kid: this.signingKey.kid,
          n: publicJwk.n,
          e: publicJwk.e,
        },
      ],
    };
  }

  sign(input: MarketplaceAccessClaimsInput): SignedMarketplaceAccessToken {
    if (!this.signingKey) {
      throw new Error('Access-token signing is unavailable.');
    }

    return signMarketplaceAccessToken(input, this.signingKey);
  }
}
