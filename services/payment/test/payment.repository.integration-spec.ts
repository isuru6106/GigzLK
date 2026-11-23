import 'dotenv/config';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { DatabaseService } from '../src/database.service';
import { PaymentRepository } from '../src/payments/payment.repository';
import { PaymentReleaseService } from '../src/payments/payment-release.service';
import * as releaseJournalFactory from '../src/payments/release-journal';
import { PaymentApprovalRepository } from '../src/payments/payment-approval.repository';
describe('Payment repository with PostgreSQL', () => {
  let database: DatabaseService;
  let repository: PaymentRepository;
  const executeFile = promisify(execFile);
  const schemaName = `payment_test_${randomUUID().replaceAll('-', '')}`;
  let originalDatabaseUrl: string | undefined;
  let schemaCreated = false;

  const assignmentId = randomUUID();
  const invalidAmountAssignmentId = randomUUID();

  beforeAll(async () => {
    originalDatabaseUrl = process.env.DATABASE_URL;

    if (
      !originalDatabaseUrl ||
      new URL(originalDatabaseUrl).pathname !== '/gigzlk_payment_test'
    ) {
      throw new Error('Payment integration tests require gigzlk_payment_test');
    }

    const url = new URL(originalDatabaseUrl);
    url.searchParams.set('schema', schemaName);
    url.searchParams.set('options', `-c search_path=${schemaName}`);
    process.env.DATABASE_URL = url.toString();

    database = new DatabaseService();
    await database.$connect();

    // This schema name contains only a fixed prefix and generated UUID.
    await database.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
    schemaCreated = true;

    await executeFile(
      process.execPath,
      [
        resolve('node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
        '--config',
        './prisma7.config.ts',
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env },
        timeout: 60_000,
      },
    );

    const [location] = await database.$queryRaw<
      { active_schema: string | null }[]
    >`SELECT current_schema() AS active_schema`;

    expect(location.active_schema).toBe(schemaName);

    repository = new PaymentRepository(database);
  }, 90_000);

  afterAll(async () => {
    try {
      if (database && schemaCreated) {
        await database.$executeRawUnsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      }
    } finally {
      try {
        if (database) {
          await database.$disconnect();
        }
      } finally {
        if (originalDatabaseUrl === undefined) {
          delete process.env.DATABASE_URL;
        } else {
          process.env.DATABASE_URL = originalDatabaseUrl;
        }
      }
    }
  }, 30_000);

  it('saves and retrieves a payment with its initial state', async () => {
    const created = await repository.createForAssignment(
      assignmentId,
      1_000_000,
    );

    expect(created).toMatchObject({
      assignmentId,
      grossMinor: 1_000_000n,
      currency: 'LKR',
      fundedAt: null,
      approvedAt: null,
      releasedAt: null,
      holdActive: false,
      version: 0,
    });

    expect(await repository.findById(created.id)).toEqual(created);
    expect(await repository.findByAssignmentId(assignmentId)).toEqual(created);
  });

  it('rejects a second payment for the same assignment', async () => {
    const id = randomUUID();

    try {
      await repository.createForAssignment(id, 10_000);

      await expect(
        repository.createForAssignment(id, 10_000),
      ).rejects.toMatchObject({ code: 'P2002' });

      expect(
        await database.payment.count({ where: { assignmentId: id } }),
      ).toBe(1);
    } finally {
      await database.payment.deleteMany({
        where: { assignmentId: id },
      });
    }
  });

  it('rejects an invalid amount without saving a payment', async () => {
    await expect(
      repository.createForAssignment(invalidAmountAssignmentId, -100),
    ).rejects.toThrow();

    expect(
      await repository.findByAssignmentId(invalidAmountAssignmentId),
    ).toBeNull();
  });

  async function withPayment(
    run: (paymentId: string) => Promise<void>,
  ): Promise<void> {
    const payment = await repository.createForAssignment(
      randomUUID(),
      1_000_000,
    );

    await run(payment.id);
  }

  it('records simultaneous funding confirmations only once', async () => {
    await withPayment(async (paymentId) => {
      const results = await Promise.all([
        repository.markFunded(paymentId),
        repository.markFunded(paymentId),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);

      const funded = await repository.findById(paymentId);

      expect(funded?.fundedAt).toBeInstanceOf(Date);
      expect(funded?.version).toBe(1);

      expect(await repository.markFunded(paymentId)).toBe(false);

      const retried = await repository.findById(paymentId);

      expect(retried?.fundedAt).toEqual(funded?.fundedAt);
      expect(retried?.version).toBe(1);
    });
  });

  it('requires funding and records approval only once', async () => {
    await withPayment(async (paymentId) => {
      expect(await repository.markApproved(paymentId)).toBe(false);
      expect((await repository.findById(paymentId))?.version).toBe(0);

      expect(await repository.markFunded(paymentId)).toBe(true);
      expect(await repository.markApproved(paymentId)).toBe(true);

      const approved = await repository.findById(paymentId);

      expect(approved?.approvedAt).toBeInstanceOf(Date);
      expect(approved?.version).toBe(2);

      expect(await repository.markApproved(paymentId)).toBe(false);

      const retried = await repository.findById(paymentId);

      expect(retried?.approvedAt).toEqual(approved?.approvedAt);
      expect(retried?.version).toBe(2);
    });
  });

  it('blocks approval during a hold and allows it after clearing', async () => {
    await withPayment(async (paymentId) => {
      expect(await repository.markFunded(paymentId)).toBe(true);
      expect(await repository.setHold(paymentId, true)).toBe(true);
      expect(await repository.setHold(paymentId, true)).toBe(false);
      expect(await repository.markApproved(paymentId)).toBe(false);

      expect(await repository.setHold(paymentId, false)).toBe(true);
      expect(await repository.setHold(paymentId, false)).toBe(false);
      expect(await repository.markApproved(paymentId)).toBe(true);

      const payment = await repository.findById(paymentId);

      expect(payment?.holdActive).toBe(false);
      expect(payment?.version).toBe(4);
    });
  });

  it('does not change a released payment', async () => {
    await withPayment(async (paymentId) => {
      // Set up a released record for this test only.
      const timestamp = new Date();

      await database.payment.update({
        where: { id: paymentId },
        data: {
          fundedAt: timestamp,
          approvedAt: timestamp,
          releasedAt: timestamp,
        },
      });

      const before = await repository.findById(paymentId);

      expect(await repository.markFunded(paymentId)).toBe(false);
      expect(await repository.markApproved(paymentId)).toBe(false);
      expect(await repository.setHold(paymentId, true)).toBe(false);

      expect(await repository.findById(paymentId)).toEqual(before);
    });
  });

  it('does not create records for missing payment IDs', async () => {
    const paymentId = randomUUID();

    expect(await repository.markFunded(paymentId)).toBe(false);
    expect(await repository.markApproved(paymentId)).toBe(false);
    expect(await repository.setHold(paymentId, true)).toBe(false);
    expect(await repository.findById(paymentId)).toBeNull();
  });

  it('releases once for concurrent retries and persists the result', async () => {
    await withPayment(async (paymentId) => {
      await repository.markFunded(paymentId);
      await repository.markApproved(paymentId);

      const service = new PaymentReleaseService(database);
      const key = randomUUID();

      const [first, second] = await Promise.all([
        service.release(paymentId, 'test-caller', key),
        service.release(paymentId, 'test-caller', key),
      ]);

      expect(first.id).toBe(second.id);
      expect(first.grossMinor).toBe(1_000_000n);
      expect(first.commissionMinor).toBe(100_000n);
      expect(first.netMinor).toBe(900_000n);
      expect(first.entries).toHaveLength(3);

      const debits = first.entries
        .filter((entry) => entry.side === 'DEBIT')
        .reduce((sum, entry) => sum + entry.amountMinor, 0n);

      const credits = first.entries
        .filter((entry) => entry.side === 'CREDIT')
        .reduce((sum, entry) => sum + entry.amountMinor, 0n);

      expect(debits).toBe(1_000_000n);
      expect(credits).toBe(debits);

      const payment = await repository.findById(paymentId);

      expect(payment?.releasedAt).toBeInstanceOf(Date);
      expect(payment?.version).toBe(3);

      // A fresh service instance retrieves the database result.
      const freshService = new PaymentReleaseService(database);
      const replay = await freshService.release(paymentId, 'test-caller', key);

      expect(replay).toEqual(first);
      const events = await database.outboxEvent.findMany({
        where: { aggregateId: paymentId },
      });

      // Concurrent requests and a later retry produce one durable event.
      expect(events).toHaveLength(1);

      const event = events[0];

      expect(event).toMatchObject({
        eventType: 'PAYMENT_RELEASED',
        schemaVersion: 1,
        producer: 'payment',
        aggregateId: paymentId,
        aggregateVersion: payment?.version,
        occurredAt: payment?.releasedAt,
        causationId: null,
        publishedAt: null,
        attempts: 0,
      });

      expect(event.eventId).toEqual(expect.any(String));
      expect(event.correlationId).toEqual(expect.any(String));

      expect(event.data).toEqual({
        paymentId,
        assignmentId: payment?.assignmentId,
        releaseJournalId: first.id,
        grossMinor: '1000000',
        commissionMinor: '100000',
        netMinor: '900000',
        currency: 'LKR',
        releasedAt: payment?.releasedAt?.toISOString(),
      });

      // Delivery metadata must not leak into the event's business payload.
      expect(() => JSON.stringify(event.data)).not.toThrow();

      expect(
        await database.releaseJournal.count({ where: { paymentId } }),
      ).toBe(1);
    });
  });

  it('rejects unfunded, unapproved and held payments without a journal', async () => {
    await withPayment(async (paymentId) => {
      const service = new PaymentReleaseService(database);
      const key = randomUUID();

      await expect(
        service.release(paymentId, 'test-caller', key),
      ).rejects.toThrow('not eligible');

      await repository.markFunded(paymentId);

      await expect(
        service.release(paymentId, 'test-caller', key),
      ).rejects.toThrow('not eligible');

      await repository.markApproved(paymentId);
      await repository.setHold(paymentId, true);

      await expect(
        service.release(paymentId, 'test-caller', key),
      ).rejects.toThrow('not eligible');

      expect((await repository.findById(paymentId))?.releasedAt).toBeNull();

      expect(
        await database.releaseJournal.count({ where: { paymentId } }),
      ).toBe(0);

      expect(
        await database.outboxEvent.count({
          where: { aggregateId: paymentId },
        }),
      ).toBe(0);
    });
  });

  it('rejects another release key and cross-payment key reuse', async () => {
    await withPayment(async (paymentId) => {
      await repository.markFunded(paymentId);
      await repository.markApproved(paymentId);

      const service = new PaymentReleaseService(database);
      const key = randomUUID();

      await service.release(paymentId, 'test-caller', key);

      await expect(
        service.release(paymentId, 'test-caller', randomUUID()),
      ).rejects.toThrow('not eligible');

      await withPayment(async (otherPaymentId) => {
        await expect(
          service.release(otherPaymentId, 'test-caller', key),
        ).rejects.toThrow('another payment');

        expect(
          (await repository.findById(otherPaymentId))?.releasedAt,
        ).toBeNull();
      });
    });
  });

  it('rolls back release when a ledger entry is rejected', async () => {
    await withPayment(async (paymentId) => {
      await repository.markFunded(paymentId);
      await repository.markApproved(paymentId);

      const before = await repository.findById(paymentId);
      const service = new PaymentReleaseService(database);
      const key = randomUUID();

      const journalSpy = jest
        .spyOn(releaseJournalFactory, 'createReleaseJournal')
        .mockReturnValue([
          {
            account: 'PROTECTED_FUNDS',
            side: 'DEBIT',
            amountMinor: 0,
            currency: 'LKR',
          },
          {
            account: 'WORKER_PAYABLE',
            side: 'CREDIT',
            amountMinor: 0,
            currency: 'LKR',
          },
        ]);

      try {
        await expect(
          service.release(paymentId, 'test-caller', key),
        ).rejects.toThrow();
      } finally {
        journalSpy.mockRestore();
      }

      // The earlier payment update must also have been rolled back.
      expect(await repository.findById(paymentId)).toEqual(before);

      expect(
        await database.releaseJournal.count({
          where: { paymentId },
        }),
      ).toBe(0);

      // The failed transaction must not consume the idempotency key.
      const released = await service.release(paymentId, 'test-caller', key);

      expect(released.paymentId).toBe(paymentId);
      expect(released.entries).toHaveLength(3);
      expect((await repository.findById(paymentId))?.releasedAt).toBeInstanceOf(
        Date,
      );
    });
  });
  it('rolls back payment and journal when the outbox insert fails', async () => {
    await withPayment(async (paymentId) => {
      await repository.markFunded(paymentId);
      await repository.markApproved(paymentId);

      const before = await repository.findById(paymentId);
      const key = randomUUID();

      // Keep real PostgreSQL transactions, but simulate an outbox failure.
      const failingDatabase = database.$extends({
        query: {
          outboxEvent: {
            create() {
              throw new Error('Simulated outbox insert failure');
            },
          },
        },
      });

      // The extended client lacks Nest lifecycle methods in its type.
      // This cast is limited to this failure-injection test.
      const failingService = new PaymentReleaseService(
        failingDatabase as unknown as DatabaseService,
      );

      await expect(
        failingService.release(paymentId, 'test-caller', key),
      ).rejects.toThrow('Simulated outbox insert failure');

      expect(await repository.findById(paymentId)).toEqual(before);

      expect(
        await database.releaseJournal.count({
          where: { paymentId },
        }),
      ).toBe(0);

      expect(
        await database.outboxEvent.count({
          where: { aggregateId: paymentId },
        }),
      ).toBe(0);

      // A normal retry with the same key must still succeed.
      const service = new PaymentReleaseService(database);
      const journal = await service.release(paymentId, 'test-caller', key);

      expect(journal.paymentId).toBe(paymentId);
      expect((await repository.findById(paymentId))?.releasedAt).toBeInstanceOf(
        Date,
      );

      expect(
        await database.outboxEvent.count({
          where: { aggregateId: paymentId },
        }),
      ).toBe(1);
    });
  });
  it('rejects ledger updates, deletes and truncation', async () => {
    await withPayment(async (paymentId) => {
      await repository.markFunded(paymentId);
      await repository.markApproved(paymentId);

      const service = new PaymentReleaseService(database);
      const key = randomUUID();
      const journal = await service.release(paymentId, 'test-caller', key);

      const immutableError = {
        code: 'P2010',
        meta: {
          driverAdapterError: expect.objectContaining({
            message: 'Release ledger records are immutable',
          }),
        },
      };

      await expect(
        database.$executeRaw`
          UPDATE "ReleaseJournal"
          SET "callerId" = 'changed'
          WHERE "id" = ${journal.id}::uuid
        `,
      ).rejects.toMatchObject(immutableError);

      await expect(
        database.$executeRaw`
          DELETE FROM "ReleaseJournal"
          WHERE "id" = ${journal.id}::uuid
        `,
      ).rejects.toMatchObject(immutableError);

      await expect(
        database.$executeRaw`
          UPDATE "LedgerEntry"
          SET "position" = "position"
          WHERE "journalId" = ${journal.id}::uuid
        `,
      ).rejects.toMatchObject(immutableError);

      await expect(
        database.$executeRaw`
          DELETE FROM "LedgerEntry"
          WHERE "journalId" = ${journal.id}::uuid
        `,
      ).rejects.toMatchObject(immutableError);

      await expect(
        database.$executeRaw`TRUNCATE TABLE "LedgerEntry"`,
      ).rejects.toMatchObject(immutableError);

      await expect(
        database.$executeRaw`
          TRUNCATE TABLE "ReleaseJournal", "LedgerEntry"
        `,
      ).rejects.toMatchObject(immutableError);

      expect(await service.release(paymentId, 'test-caller', key)).toEqual(
        journal,
      );
    });
  });
  it('rejects extra entries on an existing release journal', async () => {
    await withPayment(async (paymentId) => {
      await repository.markFunded(paymentId);
      await repository.markApproved(paymentId);

      const service = new PaymentReleaseService(database);
      const key = randomUUID();
      const journal = await service.release(paymentId, 'test-caller', key);

      await expect(
        database.$executeRaw`
          INSERT INTO "LedgerEntry" (
            "id", "journalId", "position", "account",
            "side", "amountMinor", "currency"
          )
          VALUES (
            ${randomUUID()}::uuid,
            ${journal.id}::uuid,
            99,
            'WORKER_PAYABLE',
            'CREDIT',
            1,
            'LKR'
          )
        `,
      ).rejects.toMatchObject({
        code: 'P2010',
        meta: {
          driverAdapterError: expect.objectContaining({
            message: 'Release journal entries do not match journal amounts',
          }),
        },
      });

      expect(await service.release(paymentId, 'test-caller', key)).toEqual(
        journal,
      );
    });
  });
  it('rejects a journal without accounting entries', async () => {
    await withPayment(async (paymentId) => {
      const journalId = randomUUID();

      await expect(
        database.$executeRaw`
          INSERT INTO "ReleaseJournal" (
            "id", "paymentId", "callerId", "idempotencyKey",
            "grossMinor", "commissionMinor", "netMinor", "currency"
          )
          VALUES (
            ${journalId}::uuid,
            ${paymentId}::uuid,
            'test-caller',
            ${randomUUID()},
            1000000,
            100000,
            900000,
            'LKR'
          )
        `,
      ).rejects.toMatchObject({
        code: 'P2010',
        meta: {
          driverAdapterError: expect.objectContaining({
            message: 'Release journal entries do not match journal amounts',
          }),
        },
      });

      expect(
        await database.releaseJournal.findUnique({
          where: { id: journalId },
        }),
      ).toBeNull();
    });
  });
  it('releases with two entries when commission rounds to zero', async () => {
    const payment = await repository.createForAssignment(randomUUID(), 4);

    await repository.markFunded(payment.id);
    await repository.markApproved(payment.id);

    const service = new PaymentReleaseService(database);
    const key = randomUUID();
    const journal = await service.release(payment.id, 'test-caller', key);

    expect(journal.grossMinor).toBe(4n);
    expect(journal.commissionMinor).toBe(0n);
    expect(journal.netMinor).toBe(4n);

    expect(journal.entries).toMatchObject([
      {
        position: 0,
        account: 'PROTECTED_FUNDS',
        side: 'DEBIT',
        amountMinor: 4n,
        currency: 'LKR',
      },
      {
        position: 1,
        account: 'WORKER_PAYABLE',
        side: 'CREDIT',
        amountMinor: 4n,
        currency: 'LKR',
      },
    ]);

    expect(await service.release(payment.id, 'test-caller', key)).toEqual(
      journal,
    );
  });
  it('approves once for concurrent retries and preserves the response', async () => {
    await withPayment(async (paymentId) => {
      await repository.markFunded(paymentId);

      const funded = await repository.findById(paymentId);

      if (!funded) {
        throw new Error('Expected payment fixture');
      }

      const approvals = new PaymentApprovalRepository(database);
      const callerId = randomUUID();
      const key = randomUUID();

      const [first, second] = await Promise.all([
        approvals.approve(paymentId, callerId, key, funded.version),
        approvals.approve(paymentId, callerId, key, funded.version),
      ]);

      expect(second).toEqual(first);

      const approved = await repository.findById(paymentId);

      expect(approved?.approvedAt).toBeInstanceOf(Date);
      expect(approved?.version).toBe(funded.version + 1);

      expect(
        await database.paymentApprovalRequest.count({
          where: { callerId, idempotencyKey: key },
        }),
      ).toBe(1);

      // Change current state, then verify retry returns the original snapshot.
      await repository.setHold(paymentId, true);

      const freshApprovals = new PaymentApprovalRepository(database);

      expect(
        await freshApprovals.approve(paymentId, callerId, key, funded.version),
      ).toEqual(first);
    });
  });

  it('rejects approval key reuse for another payment', async () => {
    await withPayment(async (paymentId) => {
      await repository.markFunded(paymentId);

      const funded = await repository.findById(paymentId);

      if (!funded) {
        throw new Error('Expected payment fixture');
      }

      const approvals = new PaymentApprovalRepository(database);
      const callerId = randomUUID();
      const key = randomUUID();

      await approvals.approve(paymentId, callerId, key, funded.version);

      await withPayment(async (otherPaymentId) => {
        await expect(
          approvals.approve(otherPaymentId, callerId, key, 0),
        ).rejects.toMatchObject({
          code: 'IDEMPOTENCY_CONFLICT',
        });

        expect(
          (await repository.findById(otherPaymentId))?.approvedAt,
        ).toBeNull();
      });
    });
  });

  it('rolls back approval when saving the retry record fails', async () => {
    await withPayment(async (paymentId) => {
      await repository.markFunded(paymentId);

      const before = await repository.findById(paymentId);

      if (!before) {
        throw new Error('Expected payment fixture');
      }

      const callerId = randomUUID();
      const key = randomUUID();

      const failingDatabase = database.$extends({
        query: {
          paymentApprovalRequest: {
            create() {
              throw new Error('Simulated approval record failure');
            },
          },
        },
      });

      const approvals = new PaymentApprovalRepository(
        failingDatabase as unknown as DatabaseService,
      );

      await expect(
        approvals.approve(paymentId, callerId, key, before.version),
      ).rejects.toThrow('Simulated approval record failure');

      expect(await repository.findById(paymentId)).toEqual(before);

      expect(
        await database.paymentApprovalRequest.count({
          where: { callerId, idempotencyKey: key },
        }),
      ).toBe(0);

      const normalApprovals = new PaymentApprovalRepository(database);

      await normalApprovals.approve(paymentId, callerId, key, before.version);

      expect((await repository.findById(paymentId))?.approvedAt).toBeInstanceOf(
        Date,
      );
    });
  });
});
