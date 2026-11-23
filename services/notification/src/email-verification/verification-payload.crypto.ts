import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedVerificationPayload {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  authenticationTag: Uint8Array;
  encryptionKeyId: string;
}

export interface VerificationPayloadContext {
  notificationId: string;
  callerId: string;
}

export class VerificationPayloadCrypto {
  private readonly keys = new Map<string, Buffer>();

  constructor(
    private readonly activeKeyId: string,
    keys: ReadonlyMap<string, Uint8Array>,
  ) {
    for (const [keyId, key] of keys) {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(keyId) || key.byteLength !== 32) {
        throw new Error('Invalid verification encryption configuration');
      }

      this.keys.set(keyId, Buffer.from(key));
    }

    if (!this.keys.has(activeKeyId)) {
      throw new Error('Invalid verification encryption configuration');
    }
  }

  encrypt(
    plaintext: string,
    context: VerificationPayloadContext,
  ): EncryptedVerificationPayload {
    const input = Buffer.from(plaintext, 'utf8');

    if (input.length === 0 || input.length > 16_384) {
      throw new Error('Invalid verification payload size');
    }

    const key = this.keys.get(this.activeKeyId);

    if (!key) {
      throw new Error('Verification encryption key unavailable');
    }

    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce, {
      authTagLength: 16,
    });

    cipher.setAAD(this.additionalData(context, this.activeKeyId));

    return {
      ciphertext: Buffer.concat([cipher.update(input), cipher.final()]),
      nonce,
      authenticationTag: cipher.getAuthTag(),
      encryptionKeyId: this.activeKeyId,
    };
  }

  decrypt(
    payload: EncryptedVerificationPayload,
    context: VerificationPayloadContext,
  ): string {
    try {
      const key = this.keys.get(payload.encryptionKeyId);

      if (
        !key ||
        payload.nonce.byteLength !== 12 ||
        payload.authenticationTag.byteLength !== 16 ||
        payload.ciphertext.byteLength === 0 ||
        payload.ciphertext.byteLength > 16_384
      ) {
        throw new Error();
      }

      const decipher = createDecipheriv('aes-256-gcm', key, payload.nonce, {
        authTagLength: 16,
      });

      decipher.setAAD(this.additionalData(context, payload.encryptionKeyId));
      decipher.setAuthTag(payload.authenticationTag);

      return Buffer.concat([
        decipher.update(payload.ciphertext),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('Verification payload could not be decrypted');
    }
  }

  private additionalData(
    context: VerificationPayloadContext,
    keyId: string,
  ): Buffer {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        context.notificationId,
      ) ||
      context.callerId.length === 0 ||
      context.callerId.length > 100 ||
      context.callerId !== context.callerId.trim()
    ) {
      throw new Error('Invalid verification payload context');
    }

    return Buffer.from(
      JSON.stringify([
        'email-verification-v1',
        context.notificationId.toLowerCase(),
        context.callerId,
        keyId,
      ]),
      'utf8',
    );
  }
}
