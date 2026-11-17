import { generateKeyPairSync } from 'node:crypto';
import { parseAssertionPublicKey } from './assertion-public-key';

describe('parseAssertionPublicKey', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const pem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const invalidKey = 'Invalid service assertion public key configuration.';

  it('accepts a valid RSA public key with Windows line endings', () => {
    const parsed = parseAssertionPublicKey(pem.replace(/\n/g, '\r\n'));

    expect(parsed.equals(publicKey)).toBe(true);
  });

  it('rejects a private key even though Node can derive its public key', () => {
    const privatePem = privateKey
      .export({ format: 'pem', type: 'pkcs8' })
      .toString();

    expect(() => parseAssertionPublicKey(privatePem)).toThrow(invalidKey);
  });

  it('rejects an RSA public key below 2048 bits', () => {
    const weak = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const weakPem = weak.publicKey
      .export({ format: 'pem', type: 'spki' })
      .toString();

    expect(() => parseAssertionPublicKey(weakPem)).toThrow(invalidKey);
  });

  it('rejects a non-RSA public key', () => {
    const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const ecPem = ec.publicKey
      .export({ format: 'pem', type: 'spki' })
      .toString();

    expect(() => parseAssertionPublicKey(ecPem)).toThrow(invalidKey);
  });

  it('rejects multiple PEM blocks', () => {
    expect(() => parseAssertionPublicKey(pem + pem)).toThrow(invalidKey);
  });

  it('rejects a public-key block that contains invalid key data', () => {
    const malformed =
      '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----';

    expect(() => parseAssertionPublicKey(malformed)).toThrow(invalidKey);
  });
});
