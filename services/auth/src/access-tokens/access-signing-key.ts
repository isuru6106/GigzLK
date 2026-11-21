import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';

const KID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type AccessSigningKey = {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
};

export function parseAccessSigningKey(
  kid: string,
  privatePem: string,
  publicPem: string,
): AccessSigningKey {
  try {
    if (
      !KID_PATTERN.test(kid) ||
      privatePem.length > 32768 ||
      publicPem.length > 8192
    ) {
      throw new Error();
    }

    const privateDer = decodePem(privatePem, 'PRIVATE KEY');
    const publicDer = decodePem(publicPem, 'PUBLIC KEY');

    const privateKey = createPrivateKey({
      key: privateDer,
      format: 'der',
      type: 'pkcs8',
    });

    const publicKey = createPublicKey({
      key: publicDer,
      format: 'der',
      type: 'spki',
    });

    for (const key of [privateKey, publicKey]) {
      if (
        key.asymmetricKeyType !== 'rsa' ||
        (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
      ) {
        throw new Error();
      }
    }

    const derivedPublicDer = createPublicKey(privateKey).export({
      format: 'der',
      type: 'spki',
    });

    const configuredPublicDer = publicKey.export({
      format: 'der',
      type: 'spki',
    });

    if (
      !configuredPublicDer.equals(publicDer) ||
      !derivedPublicDer.equals(configuredPublicDer)
    ) {
      throw new Error();
    }

    return { kid, privateKey, publicKey };
  } catch {
    throw new Error('Invalid access-token signing key configuration.');
  }
}

function decodePem(pem: string, label: 'PRIVATE KEY' | 'PUBLIC KEY'): Buffer {
  const pattern = new RegExp(
    `^-----BEGIN ${label}-----\\r?\\n` +
      `([A-Za-z0-9+/=\\r\\n]+)\\r?\\n` +
      `-----END ${label}-----\\r?\\n?$`,
  );

  const match = pattern.exec(pem);

  if (!match) {
    throw new Error();
  }

  const base64 = match[1].replace(/[\r\n]/g, '');
  const der = Buffer.from(base64, 'base64');

  if (der.length === 0 || der.toString('base64') !== base64) {
    throw new Error();
  }

  return der;
}
