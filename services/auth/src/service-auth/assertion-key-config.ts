import { readFileSync } from 'node:fs';
import {
  buildTrustedAssertionIssuers,
  type AssertionIssuerConfig,
} from './assertion-trusted-issuers';

export function loadTrustedAssertionIssuers(filePath: string | undefined) {
  try {
    if (!filePath?.trim()) {
      throw new Error();
    }

    const config: unknown = JSON.parse(readFileSync(filePath, 'utf8'));

    if (!Array.isArray(config)) {
      throw new Error();
    }

    const entries: unknown[] = config;
    return buildTrustedAssertionIssuers(entries.map(parseIssuer));
  } catch {
    throw new Error('Unable to load service assertion key configuration.');
  }
}

function parseIssuer(value: unknown): AssertionIssuerConfig {
  const entry = asRecord(value);
  const { issuer, subject, audience, keys } = entry;

  if (
    typeof issuer !== 'string' ||
    typeof subject !== 'string' ||
    typeof audience !== 'string' ||
    !Array.isArray(keys)
  ) {
    throw new Error();
  }

  const keyEntries: unknown[] = keys;

  return {
    issuer,
    subject,
    audience,
    keys: keyEntries.map((value) => {
      const { kid, pem } = asRecord(value);

      if (typeof kid !== 'string' || typeof pem !== 'string') {
        throw new Error();
      }

      return { kid, pem };
    }),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error();
  }

  return value as Record<string, unknown>;
}
