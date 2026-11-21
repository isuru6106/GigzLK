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

  sign(input: MarketplaceAccessClaimsInput): SignedMarketplaceAccessToken {
    if (!this.signingKey) {
      throw new Error('Access-token signing is unavailable.');
    }

    return signMarketplaceAccessToken(input, this.signingKey);
  }
}
