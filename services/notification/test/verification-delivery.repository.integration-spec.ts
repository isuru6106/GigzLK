import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { DatabaseService } from '../src/database.service';
import { VerificationDeliveryRepository } from '../src/email-verification/verification-delivery.repository';
import { VerificationNotificationRepository } from '../src/email-verification/verification-notification.repository';
import { VerificationPayloadCrypto } from '../src/email-verification/verification-payload.crypto';
import { VerificationRequestFingerprint } from '../src/email-verification/verification-request.fingerprint';
import { LocalVerificationDelivery } from '../src/email-verification/verification-delivery';
import { VerificationDeliveryWorker } from '../src/email-verification/verification-delivery.worker';

describe('Verification delivery repository with PostgreSQL', () => {
  let database: DatabaseService;
  let delivery: VerificationDeliveryRepository;
  let acceptance: VerificationNotificationRepository;

  const callerId = `delivery-test-${randomUUID()}`;

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;

    if (
      !connectionString ||
      new URL(connectionString).pathname !== '/gigzlk_notification_test'
    ) {
      throw new Error(
        'Delivery integration tests require gigzlk_notification_test',
      );
    }

    database = new DatabaseService();
    await database.$connect();

    if ((await database.verificationNotification.count()) !== 0) {
      throw new Error(
        'Test notification database must be empty; no records were deleted',
      );
    }

    delivery = new VerificationDeliveryRepository(database);
    acceptance = new VerificationNotificationRepository(
      database,
      new VerificationPayloadCrypto(
        'test-encryption',
        new Map([['test-encryption', Buffer.alloc(32, 1)]]),
      ),
      new VerificationRequestFingerprint(
        'test-fingerprint',
        new Map([['test-fingerprint', Buffer.alloc(32, 2)]]),
      ),
      {
        origin: 'https://marketplace.example.test',
        pathname: '/verify-email',
      },
    );
  });

  afterAll(async () => {
    if (database) {
      await database.$disconnect();
    }
  });

  async function withNotification(
    run: (id: string) => Promise<void>,
  ): Promise<void> {
    const requestId = randomUUID();

    const accepted = await acceptance.accept(
      callerId,
      {
        requestId,
        recipientEmail: 'synthetic@example.test',
        verificationUrl:
          'https://marketplace.example.test/verify-email#synthetic-token',
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        templateId: 'email-verification-v1',
      },
      requestId,
    );

    const id = accepted.notification.notificationId;

    try {
      await run(id);
    } finally {
      await database.verificationNotification.deleteMany({
        where: { id },
      });
    }
  }

  async function claim(id: string) {
    const notification = await delivery.claimNext();

    if (!notification || notification.id !== id || !notification.claimId) {
      throw new Error('Expected notification with an exclusive claim');
    }

    return { notification, claimId: notification.claimId };
  }

  it('allows only one concurrent claim', async () => {
    await withNotification(async (id) => {
      const results = await Promise.all([
        delivery.claimNext(),
        delivery.claimNext(),
      ]);

      expect(results.filter((result) => result !== null)).toHaveLength(1);

      const stored = await database.verificationNotification.findUniqueOrThrow({
        where: { id },
      });

      expect(stored.status).toBe('SENDING');
      expect(stored.attempts).toBe(1);
      expect(stored.claimId).not.toBeNull();
    });
  });

  it('requires claim ownership and deletes payload after acceptance', async () => {
    await withNotification(async (id) => {
      const owned = await claim(id);

      expect(
        await delivery.recordResult(id, randomUUID(), {
          outcome: 'ACCEPTED',
          providerReference: 'local-simulation:test',
        }),
      ).toBe(false);

      expect(
        await delivery.recordResult(id, owned.claimId, {
          outcome: 'ACCEPTED',
          providerReference: 'local-simulation:test',
        }),
      ).toBe(true);

      const stored = await database.verificationNotification.findUniqueOrThrow({
        where: { id },
        include: { payload: true },
      });

      expect(stored.status).toBe('SENT');
      expect(stored.deliveryOutcome).toBe('ACCEPTED');
      expect(stored.claimId).toBeNull();
      expect(stored.claimExpiresAt).toBeNull();
      expect(stored.payload).toBeNull();
      expect(await delivery.claimNext()).toBeNull();
    });
  });

  it('schedules a definite failure for retry and retains its payload', async () => {
    await withNotification(async (id) => {
      const owned = await claim(id);

      expect(
        await delivery.recordResult(id, owned.claimId, {
          outcome: 'NOT_SENT',
          retryable: true,
        }),
      ).toBe(true);

      const stored = await database.verificationNotification.findUniqueOrThrow({
        where: { id },
        include: { payload: true },
      });

      expect(stored.status).toBe('RETRY_WAIT');
      expect(stored.deliveryOutcome).toBe('NOT_SENT');
      expect(stored.nextAttemptAt.getTime()).toBeGreaterThan(
        owned.notification.updatedAt.getTime(),
      );
      expect(stored.payload).not.toBeNull();
      expect(stored.claimId).toBeNull();
    });
  });

  it('does not automatically retry an uncertain delivery', async () => {
    await withNotification(async (id) => {
      const owned = await claim(id);

      await delivery.recordResult(id, owned.claimId, {
        outcome: 'MAY_HAVE_BEEN_SENT',
      });

      const stored = await database.verificationNotification.findUniqueOrThrow({
        where: { id },
        include: { payload: true },
      });

      expect(stored.status).toBe('DELIVERY_UNKNOWN');
      expect(stored.deliveryOutcome).toBe('MAY_HAVE_BEEN_SENT');
      expect(stored.payload).not.toBeNull();
      expect(await delivery.claimNext()).toBeNull();
    });
  });

  it('recovers a crashed worker without allowing its stale result', async () => {
    await withNotification(async (id) => {
      const owned = await claim(id);

      await database.verificationNotification.update({
        where: { id },
        data: {
          claimExpiresAt: new Date(Date.now() - 60_000),
        },
      });

      expect(await delivery.recoverUnavailable()).toBe(1);

      expect(
        await delivery.recordResult(id, owned.claimId, {
          outcome: 'ACCEPTED',
          providerReference: 'local-simulation:stale',
        }),
      ).toBe(false);

      const stored = await database.verificationNotification.findUniqueOrThrow({
        where: { id },
      });

      expect(stored.status).toBe('DELIVERY_UNKNOWN');
      expect(stored.deliveryOutcome).toBe('MAY_HAVE_BEEN_SENT');
      expect(stored.claimId).toBeNull();
      expect(await delivery.claimNext()).toBeNull();
    });
  });
  it('stops after the fifth definite failure and removes the payload', async () => {
    await withNotification(async (id) => {
      await database.verificationNotification.update({
        where: { id },
        data: { attempts: 4 },
      });

      const owned = await claim(id);

      expect(owned.notification.attempts).toBe(5);

      await delivery.recordResult(id, owned.claimId, {
        outcome: 'NOT_SENT',
        retryable: true,
      });

      const stored = await database.verificationNotification.findUniqueOrThrow({
        where: { id },
        include: { payload: true },
      });

      expect(stored.status).toBe('FAILED');
      expect(stored.deliveryOutcome).toBe('NOT_SENT');
      expect(stored.payload).toBeNull();
      expect(await delivery.claimNext()).toBeNull();
    });
  });

  it('stops immediately after a permanent failure', async () => {
    await withNotification(async (id) => {
      const owned = await claim(id);

      await delivery.recordResult(id, owned.claimId, {
        outcome: 'NOT_SENT',
        retryable: false,
      });

      const stored = await database.verificationNotification.findUniqueOrThrow({
        where: { id },
        include: { payload: true },
      });

      expect(stored.status).toBe('FAILED');
      expect(stored.attempts).toBe(1);
      expect(stored.payload).toBeNull();
    });
  });

  it('expires uncertain delivery without claiming it was not sent', async () => {
    await withNotification(async (id) => {
      const owned = await claim(id);

      await delivery.recordResult(id, owned.claimId, {
        outcome: 'MAY_HAVE_BEEN_SENT',
      });

      const expiresAt = new Date(Date.now() - 60_000);

      // Keep the database's cutoff and retention constraints consistent.
      await database.verificationNotification.update({
        where: { id },
        data: {
          expiresAt,
          sendBefore: new Date(expiresAt.getTime() - 120_000),
          metadataDeleteAfter: new Date(
            expiresAt.getTime() + 7 * 24 * 60 * 60 * 1_000,
          ),
        },
      });

      expect(await delivery.recoverUnavailable()).toBe(1);

      const stored = await database.verificationNotification.findUniqueOrThrow({
        where: { id },
        include: { payload: true },
      });

      expect(stored.status).toBe('EXPIRED');
      expect(stored.deliveryOutcome).toBe('MAY_HAVE_BEEN_SENT');
      expect(stored.payload).toBeNull();
      expect(await delivery.claimNext()).toBeNull();
    });
  });
  it('processes an encrypted notification through the local worker', async () => {
    await withNotification(async (id) => {
      const worker = new VerificationDeliveryWorker(
        delivery,
        new VerificationPayloadCrypto(
          'test-encryption',
          new Map([['test-encryption', Buffer.alloc(32, 1)]]),
        ),
        new LocalVerificationDelivery(),
      );

      expect(await worker.runOnce()).toBe('RECORDED');

      const stored = await database.verificationNotification.findUniqueOrThrow({
        where: { id },
        include: { payload: true },
      });

      expect(stored.status).toBe('SENT');
      expect(stored.deliveryOutcome).toBe('ACCEPTED');
      expect(stored.providerReference).toBe(`local-simulation:${id}`);
      expect(stored.attempts).toBe(1);
      expect(stored.claimId).toBeNull();
      expect(stored.payload).toBeNull();

      expect(await worker.runOnce()).toBe('IDLE');
    });
  });
  it('cancels a queued notification and removes its payload', async () => {
    await withNotification(async (id) => {
      expect(await delivery.cancel(callerId, id)).toBe(true);

      const stored = await database.verificationNotification.findUniqueOrThrow({
        where: { id },
        include: { payload: true },
      });

      expect(stored.status).toBe('CANCELLED');
      expect(stored.cancellationRequested).toBe(true);
      expect(stored.deliveryOutcome).toBe('NOT_SENT');
      expect(stored.payload).toBeNull();
      expect(await delivery.claimNext()).toBeNull();

      // Repeated cancellation remains safe.
      expect(await delivery.cancel(callerId, id)).toBe(true);
    });
  });

  it('does not allow another caller to cancel a notification', async () => {
    await withNotification(async (id) => {
      expect(await delivery.cancel('another-service', id)).toBe(false);

      const stored = await database.verificationNotification.findUniqueOrThrow({
        where: { id },
        include: { payload: true },
      });

      expect(stored.status).toBe('QUEUED');
      expect(stored.cancellationRequested).toBe(false);
      expect(stored.payload).not.toBeNull();
    });
  });

  it('preserves accepted delivery when cancellation races with sending', async () => {
    await withNotification(async (id) => {
      const owned = await claim(id);

      expect(await delivery.cancel(callerId, id)).toBe(true);

      const pending = await database.verificationNotification.findUniqueOrThrow(
        {
          where: { id },
        },
      );

      expect(pending.status).toBe('SENDING');
      expect(pending.cancellationRequested).toBe(true);

      await delivery.recordResult(id, owned.claimId, {
        outcome: 'ACCEPTED',
        providerReference: 'local-simulation:accepted-before-cancellation',
      });

      const stored = await database.verificationNotification.findUniqueOrThrow({
        where: { id },
        include: { payload: true },
      });

      expect(stored.status).toBe('SENT');
      expect(stored.deliveryOutcome).toBe('ACCEPTED');
      expect(stored.cancellationRequested).toBe(true);
      expect(stored.payload).toBeNull();
    });
  });

  it('cancels an in-flight notification after a definite non-send result', async () => {
    await withNotification(async (id) => {
      const owned = await claim(id);
      await delivery.cancel(callerId, id);

      await delivery.recordResult(id, owned.claimId, {
        outcome: 'NOT_SENT',
        retryable: true,
      });

      const stored = await database.verificationNotification.findUniqueOrThrow({
        where: { id },
        include: { payload: true },
      });

      expect(stored.status).toBe('CANCELLED');
      expect(stored.deliveryOutcome).toBe('NOT_SENT');
      expect(stored.payload).toBeNull();
      expect(await delivery.claimNext()).toBeNull();
    });
  });

  it('does not turn uncertain delivery into confirmed cancellation', async () => {
    await withNotification(async (id) => {
      const owned = await claim(id);

      await delivery.recordResult(id, owned.claimId, {
        outcome: 'MAY_HAVE_BEEN_SENT',
      });

      await delivery.cancel(callerId, id);

      const stored = await database.verificationNotification.findUniqueOrThrow({
        where: { id },
      });

      expect(stored.status).toBe('DELIVERY_UNKNOWN');
      expect(stored.deliveryOutcome).toBe('MAY_HAVE_BEEN_SENT');
      expect(stored.cancellationRequested).toBe(true);
      expect(await delivery.claimNext()).toBeNull();
    });
  });
  it('keeps terminal metadata during its retention period', async () => {
    await withNotification(async (id) => {
      await delivery.cancel(callerId, id);

      expect(await delivery.deleteExpiredMetadata()).toBe(0);

      const stored = await database.verificationNotification.findUnique({
        where: { id },
      });

      expect(stored?.status).toBe('CANCELLED');
    });
  });

  it('deletes terminal metadata after its retention period', async () => {
    await withNotification(async (id) => {
      await delivery.cancel(callerId, id);

      const expiresAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000);

      await database.verificationNotification.update({
        where: { id },
        data: {
          expiresAt,
          sendBefore: new Date(expiresAt.getTime() - 120_000),
          metadataDeleteAfter: new Date(
            expiresAt.getTime() + 7 * 24 * 60 * 60 * 1_000,
          ),
        },
      });

      expect(await delivery.deleteExpiredMetadata()).toBe(1);

      expect(
        await database.verificationNotification.findUnique({
          where: { id },
        }),
      ).toBeNull();

      expect(
        await database.verificationPayload.findUnique({
          where: { notificationId: id },
        }),
      ).toBeNull();
    });
  });

  it('requires recovery before deleting old active metadata', async () => {
    await withNotification(async (id) => {
      const expiresAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000);

      await database.verificationNotification.update({
        where: { id },
        data: {
          expiresAt,
          sendBefore: new Date(expiresAt.getTime() - 120_000),
          metadataDeleteAfter: new Date(
            expiresAt.getTime() + 7 * 24 * 60 * 60 * 1_000,
          ),
        },
      });

      expect(await delivery.deleteExpiredMetadata()).toBe(0);
      expect(await delivery.recoverUnavailable()).toBe(1);

      const recovered =
        await database.verificationNotification.findUniqueOrThrow({
          where: { id },
          include: { payload: true },
        });

      expect(recovered.status).toBe('EXPIRED');
      expect(recovered.payload).toBeNull();

      expect(await delivery.deleteExpiredMetadata()).toBe(1);
    });
  });
  it('denies dispatch after cancellation and for another claim', async () => {
    await withNotification(async (id) => {
      const owned = await claim(id);

      expect(await delivery.canDispatch(id, owned.claimId)).toBe(true);
      expect(await delivery.canDispatch(id, randomUUID())).toBe(false);

      await delivery.cancel(callerId, id);

      expect(await delivery.canDispatch(id, owned.claimId)).toBe(false);
    });
  });
});
