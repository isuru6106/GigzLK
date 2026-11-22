import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { DatabaseService } from '../src/database.service';
import { PaymentRepository } from '../src/payments/payment.repository';
import { PaymentReleaseService } from '../src/payments/payment-release.service';
import * as releaseJournalFactory from '../src/payments/release-journal';

describe('Payment repository with PostgreSQL', () => {
  let database: DatabaseService;
  let repository: PaymentRepository;

  const assignmentId = randomUUID();
  const invalidAmountAssignmentId = randomUUID();

  beforeAll(async () => {
    database = new DatabaseService();
    await database.$connect();
    repository = new PaymentRepository(database);
  });

  afterAll(async () => {
    if (database) {
      try {
        await database.payment.deleteMany({
          where: {
            assignmentId: {
              in: [assignmentId, invalidAmountAssignmentId],
            },
          },
        });
      } finally {
        await database.$disconnect();
      }
    }
  });

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
    const id = randomUUID();

    try {
      const payment = await repository.createForAssignment(id, 1_000_000);
      await run(payment.id);
    } finally {
      const payment = await database.payment.findUnique({
        where: { assignmentId: id },
      });

      if (payment) {
        await database.outboxEvent.deleteMany({
          where: { aggregateId: payment.id },
        });
        const journal = await database.releaseJournal.findUnique({
          where: { paymentId: payment.id },
        });

        if (journal) {
          await database.ledgerEntry.deleteMany({
            where: { journalId: journal.id },
          });
          await database.releaseJournal.delete({
            where: { id: journal.id },
          });
        }

        await database.payment.delete({
          where: { id: payment.id },
        });
      }
    }
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
});
