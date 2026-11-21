import { generateKeyPairSync } from 'node:crypto';
import { parseAccessSigningKey } from './access-signing-key';

describe('parseAccessSigningKey', () => {
  function rsaPair(modulusLength = 2048) {
    const pair = generateKeyPairSync('rsa', { modulusLength });

    return {
      privatePem: pair.privateKey
        .export({ format: 'pem', type: 'pkcs8' })
        .toString(),
      publicPem: pair.publicKey
        .export({ format: 'pem', type: 'spki' })
        .toString(),
    };
  }

  const pair = rsaPair();
  const otherPair = rsaPair();
  const weakPair = rsaPair(1024);

  const configurationError = 'Invalid access-token signing key configuration.';

  it('accepts a matching RSA key pair', () => {
    const result = parseAccessSigningKey(
      'access-current',
      pair.privatePem,
      pair.publicPem,
    );

    expect(result.kid).toBe('access-current');
    expect(result.privateKey.type).toBe('private');
    expect(result.publicKey.type).toBe('public');
    expect(result.privateKey.asymmetricKeyType).toBe('rsa');
    expect(result.publicKey.asymmetricKeyType).toBe('rsa');
  });

  it('accepts Windows line endings', () => {
    const result = parseAccessSigningKey(
      'access-current',
      pair.privatePem.replace(/\r?\n/g, '\r\n'),
      pair.publicPem.replace(/\r?\n/g, '\r\n'),
    );

    expect(result.kid).toBe('access-current');
  });

  it('accepts a 64-character key identifier', () => {
    expect(
      parseAccessSigningKey('a'.repeat(64), pair.privatePem, pair.publicPem)
        .kid,
    ).toHaveLength(64);
  });

  it.each(['', '-key', '../key', 'key name', 'clé', 'a'.repeat(65)])(
    'rejects invalid kid: %p',
    (kid) => {
      expect(() =>
        parseAccessSigningKey(kid, pair.privatePem, pair.publicPem),
      ).toThrow(configurationError);
    },
  );

  it('rejects mismatched public and private keys', () => {
    expect(() =>
      parseAccessSigningKey(
        'access-current',
        pair.privatePem,
        otherPair.publicPem,
      ),
    ).toThrow(configurationError);
  });

  it('rejects RSA keys below 2048 bits', () => {
    expect(() =>
      parseAccessSigningKey(
        'access-current',
        weakPair.privatePem,
        weakPair.publicPem,
      ),
    ).toThrow(configurationError);
  });

  it('rejects non-RSA keys', () => {
    const ecPair = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });

    expect(() =>
      parseAccessSigningKey(
        'access-current',
        ecPair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
        ecPair.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      ),
    ).toThrow(configurationError);
  });

  it('rejects a public key in place of the private key', () => {
    expect(() =>
      parseAccessSigningKey('access-current', pair.publicPem, pair.publicPem),
    ).toThrow(configurationError);
  });

  it('rejects a private key in place of the public key', () => {
    expect(() =>
      parseAccessSigningKey('access-current', pair.privatePem, pair.privatePem),
    ).toThrow(configurationError);
  });

  it('rejects multiple private-key PEM blocks', () => {
    expect(() =>
      parseAccessSigningKey(
        'access-current',
        pair.privatePem + pair.privatePem,
        pair.publicPem,
      ),
    ).toThrow(configurationError);
  });

  it('rejects multiple public-key PEM blocks', () => {
    expect(() =>
      parseAccessSigningKey(
        'access-current',
        pair.privatePem,
        pair.publicPem + pair.publicPem,
      ),
    ).toThrow(configurationError);
  });

  it('rejects malformed private-key data safely', () => {
    expect(() =>
      parseAccessSigningKey(
        'access-current',
        '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n',
        pair.publicPem,
      ),
    ).toThrow(configurationError);
  });

  it('rejects malformed public-key data safely', () => {
    expect(() =>
      parseAccessSigningKey(
        'access-current',
        pair.privatePem,
        '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n',
      ),
    ).toThrow(configurationError);
  });

  it('rejects private-key input above its size limit', () => {
    expect(() =>
      parseAccessSigningKey(
        'access-current',
        'x'.repeat(32769),
        pair.publicPem,
      ),
    ).toThrow(configurationError);
  });

  it('rejects public-key input above its size limit', () => {
    expect(() =>
      parseAccessSigningKey(
        'access-current',
        pair.privatePem,
        'x'.repeat(8193),
      ),
    ).toThrow(configurationError);
  });
});
