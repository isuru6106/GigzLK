import { createPublicKey, type KeyObject } from 'node:crypto';

export function parseAssertionPublicKey(pem: string): KeyObject {
  try {
    const match =
      /^-----BEGIN PUBLIC KEY-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END PUBLIC KEY-----\r?\n?$/.exec(
        pem,
      );

    if (!match) {
      throw new Error();
    }

    const base64 = match[1].replace(/[\r\n]/g, '');
    const der = Buffer.from(base64, 'base64');

    if (der.length === 0 || der.toString('base64') !== base64) {
      throw new Error();
    }

    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });

    if (
      key.asymmetricKeyType !== 'rsa' ||
      (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
      !key.export({ format: 'der', type: 'spki' }).equals(der)
    ) {
      throw new Error();
    }

    return key;
  } catch {
    throw new Error('Invalid service assertion public key configuration.');
  }
}
