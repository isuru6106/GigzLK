import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { DatabaseService } from '../src/database.service';
import { PaymentRepository } from '../src/payments/payment.repository';

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
      const payment = await repository.createForAssignment(id, 10_000);
      await run(payment.id);
    } finally {
      await database.payment.deleteMany({
        where: { assignmentId: id },
      });
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
});
