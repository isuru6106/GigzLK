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
});
