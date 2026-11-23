import { describe, expect, it } from '@jest/globals';
import { VerificationPayloadCrypto } from './verification-payload.crypto';

describe('VerificationPayloadCrypto', () => {
  // Synthetic test keys only.
  const oldKey = Buffer.alloc(32, 1);
  const currentKey = Buffer.alloc(32, 2);

  const context = {
    notificationId: 'abcdef00-0000-4000-8000-000000000001',
    callerId: 'auth-service',
  };

  const plaintext = JSON.stringify({
    recipientEmail: 'synthetic@example.test',
    verificationUrl: 'https://marketplace.example.test/verify-email#test',
  });

  function createCrypto() {
    return new VerificationPayloadCrypto(
      'current',
      new Map([
        ['old', oldKey],
        ['current', currentKey],
      ]),
    );
  }

  it('encrypts and decrypts a payload', () => {
    const crypto = createCrypto();
    const encrypted = crypto.encrypt(plaintext, context);

    expect(encrypted.encryptionKeyId).toBe('current');
    expect(encrypted.nonce.byteLength).toBe(12);
    expect(encrypted.authenticationTag.byteLength).toBe(16);
    expect(
      Buffer.from(encrypted.ciphertext).equals(Buffer.from(plaintext)),
    ).toBe(false);
    expect(crypto.decrypt(encrypted, context)).toBe(plaintext);
  });

  it('uses a fresh nonce for each encryption', () => {
    const crypto = createCrypto();

    const first = crypto.encrypt(plaintext, context);
    const second = crypto.encrypt(plaintext, context);

    expect(Buffer.from(first.nonce).equals(Buffer.from(second.nonce))).toBe(
      false,
    );
  });

  it.each(['ciphertext', 'nonce', 'authenticationTag'] as const)(
    'rejects modified %s',
    (field) => {
      const crypto = createCrypto();
      const encrypted = crypto.encrypt(plaintext, context);
      const modified = Buffer.from(encrypted[field]);
      modified[0] ^= 1;

      expect(() =>
        crypto.decrypt({ ...encrypted, [field]: modified }, context),
      ).toThrow('Verification payload could not be decrypted');
    },
  );

  it('rejects a different notification', () => {
    const crypto = createCrypto();
    const encrypted = crypto.encrypt(plaintext, context);

    expect(() =>
      crypto.decrypt(encrypted, {
        ...context,
        notificationId: 'abcdef00-0000-4000-8000-000000000002',
      }),
    ).toThrow('Verification payload could not be decrypted');
  });

  it('rejects a different caller', () => {
    const crypto = createCrypto();
    const encrypted = crypto.encrypt(plaintext, context);

    expect(() =>
      crypto.decrypt(encrypted, { ...context, callerId: 'another-service' }),
    ).toThrow('Verification payload could not be decrypted');
  });

  it('decrypts an older payload after key rotation', () => {
    const previous = new VerificationPayloadCrypto(
      'old',
      new Map([['old', oldKey]]),
    );

    const encrypted = previous.encrypt(plaintext, context);

    expect(createCrypto().decrypt(encrypted, context)).toBe(plaintext);
  });

  it('rejects an unavailable key', () => {
    const crypto = createCrypto();
    const encrypted = crypto.encrypt(plaintext, context);

    expect(() =>
      crypto.decrypt({ ...encrypted, encryptionKeyId: 'missing' }, context),
    ).toThrow('Verification payload could not be decrypted');
  });

  it('rejects a different key with the same key ID', () => {
    const encrypted = createCrypto().encrypt(plaintext, context);
    const wrongCrypto = new VerificationPayloadCrypto(
      'current',
      new Map([['current', Buffer.alloc(32, 3)]]),
    );

    expect(() => wrongCrypto.decrypt(encrypted, context)).toThrow(
      'Verification payload could not be decrypted',
    );
  });

  it('copies supplied keys to prevent later mutation', () => {
    const key = Buffer.alloc(32, 4);
    const crypto = new VerificationPayloadCrypto(
      'current',
      new Map([['current', key]]),
    );

    const encrypted = crypto.encrypt(plaintext, context);
    key.fill(0);

    expect(crypto.decrypt(encrypted, context)).toBe(plaintext);
  });

  it('rejects invalid key lengths', () => {
    expect(
      () =>
        new VerificationPayloadCrypto(
          'current',
          new Map([['current', Buffer.alloc(16)]]),
        ),
    ).toThrow('Invalid verification encryption configuration');
  });

  it('requires the active key to exist', () => {
    expect(() => new VerificationPayloadCrypto('missing', new Map())).toThrow(
      'Invalid verification encryption configuration',
    );
  });

  it('rejects empty and oversized payloads', () => {
    const crypto = createCrypto();

    expect(() => crypto.encrypt('', context)).toThrow(
      'Invalid verification payload size',
    );
    expect(() => crypto.encrypt('a'.repeat(16_385), context)).toThrow(
      'Invalid verification payload size',
    );
  });
});
