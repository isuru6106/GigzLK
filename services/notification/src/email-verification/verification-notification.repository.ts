import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database.service';
import { Prisma } from '../generated/prisma/client';
import { VerificationPayloadCrypto } from './verification-payload.crypto';
import { VerificationRequestFingerprint } from './verification-request.fingerprint';
import {
  canStartVerificationDelivery,
  validateVerificationRequest,
} from './verification-request';
import type { VerificationUrlPolicy } from './verification-request';

export class VerificationRequestConflictError extends Error {
  constructor() {
    super('Verification request ID is already bound to different input');
  }
}

export class VerificationDeliveryWindowError extends Error {
  constructor() {
    super('Verification delivery window has closed');
  }
}

export class VerificationNotificationRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly encryption: VerificationPayloadCrypto,
    private readonly fingerprints: VerificationRequestFingerprint,
    private readonly urlPolicy: VerificationUrlPolicy,
  ) {}

  async accept(callerId: string, input: unknown, idempotencyKey: unknown) {
    const request = validateVerificationRequest(
      input,
      idempotencyKey,
      this.urlPolicy,
    );

    // Also validates the caller before querying storage.
    const fingerprint = this.fingerprints.calculate(callerId, request);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const previous = await tx.verificationNotification.findUnique({
              where: {
                callerId_requestId: {
                  callerId,
                  requestId: request.requestId,
                },
              },
            });

            // Check existing requests before applying the delivery cutoff.
            if (previous) {
              const expected = this.fingerprints.calculate(
                callerId,
                request,
                previous.fingerprintKeyId,
              );

              if (expected !== previous.fingerprint) {
                throw new VerificationRequestConflictError();
              }

              return {
                created: false,
                notification: this.toResponse(previous),
              };
            }

            const now = new Date();

            if (!canStartVerificationDelivery(request.expiresAt, now)) {
              throw new VerificationDeliveryWindowError();
            }

            const notificationId = randomUUID();
            const expiresAt = new Date(request.expiresAt);

            const encrypted = this.encryption.encrypt(
              JSON.stringify({
                recipientEmail: request.recipientEmail,
                verificationUrl: request.verificationUrl,
              }),
              { notificationId, callerId },
            );

            const notification = await tx.verificationNotification.create({
              data: {
                id: notificationId,
                callerId,
                requestId: request.requestId,
                fingerprint,
                fingerprintKeyId: this.fingerprints.activeKeyId,
                templateId: request.templateId,
                expiresAt,
                sendBefore: new Date(expiresAt.getTime() - 120_000),
                metadataDeleteAfter: new Date(
                  expiresAt.getTime() + 7 * 24 * 60 * 60 * 1_000,
                ),
                nextAttemptAt: now,
                payload: {
                  create: {
                    ciphertext: Buffer.from(encrypted.ciphertext),
                    nonce: Buffer.from(encrypted.nonce),
                    authenticationTag: Buffer.from(encrypted.authenticationTag),
                    encryptionKeyId: encrypted.encryptionKeyId,
                  },
                },
              },
            });

            return {
              created: true,
              notification: this.toResponse(notification),
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002');

        if (!retryable || attempt === 2) {
          throw error;
        }
      }
    }

    throw new Error('Verification notification could not be accepted');
  }

  private toResponse(notification: {
    id: string;
    requestId: string;
    status: string;
    deliveryOutcome: string;
    expiresAt: Date;
    attempts: number;
    cancellationRequested: boolean;
  }) {
    return {
      notificationId: notification.id,
      requestId: notification.requestId,
      status: notification.status,
      deliveryOutcome: notification.deliveryOutcome,
      expiresAt: notification.expiresAt.toISOString(),
      attempts: notification.attempts,
      cancellationRequested: notification.cancellationRequested,
    };
  }
}
