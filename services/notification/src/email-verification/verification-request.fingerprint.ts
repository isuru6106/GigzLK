import { createHmac } from 'node:crypto';
import type { VerificationRequest } from './verification-request';

export class VerificationRequestFingerprint {
  private readonly keys = new Map<string, Buffer>();

  constructor(
    readonly activeKeyId: string,
    keys: ReadonlyMap<string, Uint8Array>,
  ) {
    for (const [keyId, key] of keys) {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(keyId) || key.byteLength !== 32) {
        throw new Error('Invalid verification fingerprint configuration');
      }

      this.keys.set(keyId, Buffer.from(key));
    }

    if (!this.keys.has(activeKeyId)) {
      throw new Error('Invalid verification fingerprint configuration');
    }
  }

  calculate(
    callerId: string,
    request: VerificationRequest,
    keyId: string = this.activeKeyId,
  ): string {
    const key = this.keys.get(keyId);

    if (!key) {
      throw new Error('Verification fingerprint key unavailable');
    }

    if (
      callerId.length === 0 ||
      callerId.length > 100 ||
      callerId !== callerId.trim()
    ) {
      throw new Error('Invalid verification fingerprint caller');
    }

    // Fixed field order avoids dependence on object property ordering.
    // Pass only a request returned by validateVerificationRequest().
    const canonical = JSON.stringify([
      'email-verification-v1',
      callerId,
      request.requestId,
      request.recipientEmail,
      request.verificationUrl,
      request.expiresAt,
      request.templateId,
    ]);

    return createHmac('sha256', key).update(canonical, 'utf8').digest('hex');
  }
}
