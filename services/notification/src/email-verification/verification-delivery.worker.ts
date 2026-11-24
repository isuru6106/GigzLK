import type {
  VerificationDelivery,
  VerificationDeliveryResult,
} from './verification-delivery';
import { VerificationDeliveryRepository } from './verification-delivery.repository';
import { VerificationPayloadCrypto } from './verification-payload.crypto';

export class VerificationDeliveryWorker {
  constructor(
    private readonly repository: VerificationDeliveryRepository,
    private readonly encryption: VerificationPayloadCrypto,
    private readonly delivery: VerificationDelivery,
  ) {}

  async runOnce(): Promise<'IDLE' | 'RECORDED' | 'CLAIM_LOST'> {
    await this.repository.recoverUnavailable();
    await this.repository.deleteExpiredMetadata();

    const notification = await this.repository.claimNext();

    if (!notification) {
      return 'IDLE';
    }

    const claimId = notification.claimId;

    if (!claimId) {
      throw new Error('Claimed notification has no claim ID');
    }

    let result: VerificationDeliveryResult;
    let payload:
      | {
          recipientEmail: string;
          verificationUrl: string;
        }
      | undefined;

    try {
      if (!notification.payload) {
        throw new Error('Verification payload unavailable');
      }

      const decoded: unknown = JSON.parse(
        this.encryption.decrypt(notification.payload, {
          notificationId: notification.id,
          callerId: notification.callerId,
        }),
      );

      if (
        typeof decoded !== 'object' ||
        decoded === null ||
        !('recipientEmail' in decoded) ||
        typeof decoded.recipientEmail !== 'string' ||
        !('verificationUrl' in decoded) ||
        typeof decoded.verificationUrl !== 'string'
      ) {
        throw new Error('Invalid stored verification payload');
      }

      payload = {
        recipientEmail: decoded.recipientEmail,
        verificationUrl: decoded.verificationUrl,
      };
    } catch {
      // No provider call occurred. Retry within the existing attempt limit.
      // Never log the encrypted or decrypted payload.
      result = {
        outcome: 'NOT_SENT',
        retryable: true,
      };

      return (await this.repository.recordResult(
        notification.id,
        claimId,
        result,
      ))
        ? 'RECORDED'
        : 'CLAIM_LOST';
    }

    const now = Date.now();

    if (
      !notification.claimExpiresAt ||
      notification.claimExpiresAt.getTime() <= now
    ) {
      return 'CLAIM_LOST';
    }

    if (notification.sendBefore.getTime() <= now) {
      result = {
        outcome: 'NOT_SENT',
        retryable: false,
      };
    } else if (!(await this.repository.canDispatch(notification.id, claimId))) {
      result = {
        outcome: 'NOT_SENT',
        retryable: false,
      };
    } else {
      try {
        result = await this.delivery.send({
          notificationId: notification.id,
          recipientEmail: payload.recipientEmail,
          verificationUrl: payload.verificationUrl,
          expiresAt: notification.expiresAt,
        });
      } catch {
        // A thrown provider error does not prove the email was not sent.
        result = {
          outcome: 'MAY_HAVE_BEEN_SENT',
        };
      }
    }

    // Keep database failures outside the provider catch:
    // an uncertain database write must not trigger another send.
    return (await this.repository.recordResult(
      notification.id,
      claimId,
      result,
    ))
      ? 'RECORDED'
      : 'CLAIM_LOST';
  }
}
