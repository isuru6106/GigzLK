import type { KeyObject } from 'node:crypto';
import { ASSERTION_KID_PATTERN } from './assertion-policy';
import { parseAssertionPublicKey } from './assertion-public-key';
import type { TrustedAssertionIssuer } from './assertion-validator';

export interface AssertionIssuerConfig {
  issuer: string;
  subject: string;
  audience: string;
  keys: ReadonlyArray<{ kid: string; pem: string }>;
}

export function buildTrustedAssertionIssuers(
  configs: readonly AssertionIssuerConfig[],
): ReadonlyMap<string, TrustedAssertionIssuer> {
  const issuers = new Map<string, TrustedAssertionIssuer>();
  const keyOwners = new Map<string, string>();

  if (configs.length === 0) {
    invalidConfiguration();
  }

  for (const { issuer, subject, audience, keys: entries } of configs) {
    if (
      !issuer ||
      issuer.length > 255 ||
      !subject ||
      !audience ||
      entries.length === 0 ||
      issuers.has(issuer)
    ) {
      invalidConfiguration();
    }

    const keys = new Map<string, KeyObject>();

    for (const { kid, pem } of entries) {
      if (!ASSERTION_KID_PATTERN.test(kid) || keys.has(kid)) {
        invalidConfiguration();
      }

      const key = parseAssertionPublicKey(pem);
      const identity = key
        .export({ format: 'der', type: 'spki' })
        .toString('base64');
      const owner = keyOwners.get(identity);

      if (owner !== undefined && owner !== issuer) {
        invalidConfiguration();
      }

      keyOwners.set(identity, issuer);
      keys.set(kid, key);
    }

    issuers.set(issuer, { issuer, subject, audience, keys });
  }

  return issuers;
}

function invalidConfiguration(): never {
  throw new Error('Invalid service assertion issuer configuration.');
}
