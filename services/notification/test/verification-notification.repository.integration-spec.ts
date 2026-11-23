import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { DatabaseService } from '../src/database.service';
import { VerificationPayloadCrypto } from '../src/email-verification/verification-payload.crypto';
import { VerificationRequestFingerprint } from '../src/email-verification/verification-request.fingerprint';
import {
  VerificationDeliveryWindowError,
  VerificationNotificationRepository,
  VerificationRequestConflictError,
} from '../src/email-verification/verification-notification.repository';

describe('Verification notification repository with PostgreSQL', () => {
  let database: DatabaseService;
  let repository: VerificationNotificationRepository;

  const callerId = `notification-test-${randomUUID()}`;
  const encryption = new VerificationPayloadCrypto(
    'test-encryption',
    new Map([['test-encryption', Buffer.alloc(32, 1)]]),
  );
  const fingerprints = new VerificationRequestFingerprint(
    'test-fingerprint',
    new Map([['test-fingerprint', Buffer.alloc(32, 2)]]),
  );

  const policy = {
    origin: 'https://marketplace.example.test',
    pathname: '/verify-email',
  };

  function request() {
    return {
      requestId: randomUUID(),
      recipientEmail: 'synthetic@example.test',
      verificationUrl:
        'https://marketplace.example.test/verify-email#synthetic-token',
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      templateId: 'email-verification-v1',
    };
  }

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;

    if (
      !connectionString ||
      new URL(connectionString).pathname !== '/gigzlk_notification_test'
    ) {
      throw new Error(
        'Notification integration tests require gigzlk_notification_test',
      );
    }

    database = new DatabaseService();
    await database.$connect();

    repository = new VerificationNotificationRepository(
      database,
      encryption,
      fingerprints,
      policy,
    );
  });

  afterAll(async () => {
    if (database) {
      try {
        // Only remove this run's records; payloads cascade with them.
        await database.verificationNotification.deleteMany({
          where: { callerId },
        });
      } finally {
        await database.$disconnect();
      }
    }
  });

  it('stores an encrypted payload and returns only safe fields', async () => {
    const input = request();
    const result = await repository.accept(callerId, input, input.requestId);

    expect(result.created).toBe(true);
    expect(result.notification).toEqual({
      notificationId: expect.any(String),
      requestId: input.requestId,
      status: 'QUEUED',
      deliveryOutcome: 'NOT_SENT',
      expiresAt: input.expiresAt,
      attempts: 0,
      cancellationRequested: false,
    });

    const stored = await database.verificationNotification.findUniqueOrThrow({
      where: { id: result.notification.notificationId },
      include: { payload: true },
    });

    const payload = stored.payload;

    if (!payload) {
      throw new Error('Expected encrypted verification payload');
    }

    expect(
      encryption.decrypt(payload, {
        notificationId: stored.id,
        callerId,
      }),
    ).toBe(
      JSON.stringify({
        recipientEmail: input.recipientEmail,
        verificationUrl: input.verificationUrl,
      }),
    );

    expect(stored.fingerprint).toBe(
      fingerprints.calculate(callerId, {
        ...input,
        templateId: 'email-verification-v1',
      }),
    );
    expect(stored.sendBefore.getTime()).toBe(
      new Date(input.expiresAt).getTime() - 120_000,
    );
    expect(stored.metadataDeleteAfter.getTime()).toBe(
      new Date(input.expiresAt).getTime() + 7 * 24 * 60 * 60 * 1_000,
    );
  });

  it('creates only one notification for simultaneous retries', async () => {
    const input = request();

    const results = await Promise.all([
      repository.accept(callerId, input, input.requestId),
      repository.accept(callerId, input, input.requestId),
    ]);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0].notification).toEqual(results[1].notification);

    expect(
      await database.verificationNotification.count({
        where: { callerId, requestId: input.requestId },
      }),
    ).toBe(1);
  });

  it('rejects changed input under an existing request ID', async () => {
    const input = request();
    await repository.accept(callerId, input, input.requestId);

    await expect(
      repository.accept(
        callerId,
        { ...input, recipientEmail: 'another@example.test' },
        input.requestId,
      ),
    ).rejects.toBeInstanceOf(VerificationRequestConflictError);
  });

  it('rejects a new request after the delivery cutoff', async () => {
    const input = {
      ...request(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };

    await expect(
      repository.accept(callerId, input, input.requestId),
    ).rejects.toBeInstanceOf(VerificationDeliveryWindowError);

    expect(
      await database.verificationNotification.count({
        where: { callerId, requestId: input.requestId },
      }),
    ).toBe(0);
  });

  it('rolls back the notification when payload storage fails', async () => {
    const input = request();

    // Deliberately violate the database's 12-byte nonce constraint.
    const spy = jest.spyOn(encryption, 'encrypt').mockReturnValueOnce({
      ciphertext: Buffer.from('synthetic'),
      nonce: Buffer.alloc(1),
      authenticationTag: Buffer.alloc(16),
      encryptionKeyId: 'test-encryption',
    });

    try {
      await expect(
        repository.accept(callerId, input, input.requestId),
      ).rejects.toThrow();

      expect(
        await database.verificationNotification.count({
          where: { callerId, requestId: input.requestId },
        }),
      ).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
  it('returns an existing request after its delivery cutoff', async () => {
    const input = request();
    const original = await repository.accept(callerId, input, input.requestId);

    jest.useFakeTimers({
      now: new Date(input.expiresAt),
      doNotFake: [
        'nextTick',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
        'performance',
        'hrtime',
      ],
    });

    try {
      const retry = await repository.accept(callerId, input, input.requestId);

      expect(retry.created).toBe(false);
      expect(retry.notification).toEqual(original.notification);
    } finally {
      jest.useRealTimers();
    }
  });

  it('recognizes an existing request after fingerprint key rotation', async () => {
    const input = request();
    const original = await repository.accept(callerId, input, input.requestId);

    const rotatedFingerprints = new VerificationRequestFingerprint(
      'next-fingerprint',
      new Map([
        ['test-fingerprint', Buffer.alloc(32, 2)],
        ['next-fingerprint', Buffer.alloc(32, 3)],
      ]),
    );

    const rotatedRepository = new VerificationNotificationRepository(
      database,
      encryption,
      rotatedFingerprints,
      policy,
    );

    const retry = await rotatedRepository.accept(
      callerId,
      input,
      input.requestId,
    );

    expect(retry.created).toBe(false);
    expect(retry.notification).toEqual(original.notification);
  });
});
