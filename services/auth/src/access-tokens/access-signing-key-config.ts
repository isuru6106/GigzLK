import { readFileSync } from 'node:fs';
import {
  parseAccessSigningKey,
  type AccessSigningKey,
} from './access-signing-key';

export type AccessSigningKeyConfig = {
  kid: string | undefined;
  privateKeyFile: string | undefined;
  publicKeyFile: string | undefined;
};

export function loadAccessSigningKey(
  config: AccessSigningKeyConfig,
): AccessSigningKey {
  try {
    const kid = requiredValue(config.kid);
    const privateKeyFile = requiredValue(config.privateKeyFile);
    const publicKeyFile = requiredValue(config.publicKeyFile);

    const privatePem = readFileSync(privateKeyFile, 'utf8');
    const publicPem = readFileSync(publicKeyFile, 'utf8');

    return parseAccessSigningKey(kid, privatePem, publicPem);
  } catch {
    throw new Error('Unable to load access-token signing key configuration.');
  }
}

function requiredValue(value: string | undefined): string {
  if (!value || value.trim() !== value || value.length === 0) {
    throw new Error();
  }

  return value;
}
