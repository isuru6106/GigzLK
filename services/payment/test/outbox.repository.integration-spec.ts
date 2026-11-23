import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { DatabaseService } from '../src/database.service';
import { OutboxRepository } from '../src/outbox/outbox.repository';

describe('Outbox repository with PostgreSQL', () => {
  let database: DatabaseService;
  let repository: OutboxRepository;

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;

    if (
      !connectionString ||
      new URL(connectionString).pathname !== '/gigzlk_payment_test'
    ) {
      throw new Error('Outbox tests require gigzlk_payment_test');
    }

    database = new DatabaseService();
    await database.$connect();

    const existing = await database.outboxEvent.count();

    if (existing !== 0) {
      throw new Error('Test outbox must be empty before this suite starts');
    }

    repository = new OutboxRepository(database);
  });

  afterAll(async () => {
    if (database) {
      await database.$disconnect();
    }
  });

  async function withEvent(
    run: (eventId: string) => Promise<void>,
  ): Promise<void> {
    const eventId = randomUUID();

    try {
      await database.outboxEvent.create({
        data: {
          eventId,
          eventType: 'PAYMENT_RELEASED',
          schemaVersion: 1,
          producer: 'payment',
          aggregateId: randomUUID(),
          aggregateVersion: 3,
          occurredAt: new Date(),
          correlationId: randomUUID(),
          data: { currency: 'LKR', netMinor: '900000' },
        },
      });

      await run(eventId);
    } finally {
      await database.outboxEvent.deleteMany({
        where: { eventId },
      });
    }
  }

  it('allows only one concurrent claim of an event', async () => {
    await withEvent(async (eventId) => {
      const results = await Promise.all([
        repository.claimNext(),
        repository.claimNext(),
      ]);

      const claims = results.filter((result) => result !== null);

      expect(claims).toHaveLength(1);
      expect(claims[0]).toMatchObject({
        eventId,
        attempts: 1,
        publishedAt: null,
        failedAt: null,
      });
      expect(claims[0]?.claimId).toEqual(expect.any(String));
      expect(claims[0]?.claimExpiresAt).toBeInstanceOf(Date);
    });
  });

  it('requires the current claim to mark an event published', async () => {
    await withEvent(async (eventId) => {
      const claim = await repository.claimNext();

      if (!claim?.claimId) {
        throw new Error('Expected an event claim');
      }

      expect(await repository.markPublished(eventId, randomUUID())).toBe(false);

      expect(await repository.markPublished(eventId, claim.claimId)).toBe(true);

      const stored = await database.outboxEvent.findUniqueOrThrow({
        where: { eventId },
      });

      expect(stored.publishedAt).toBeInstanceOf(Date);
      expect(stored.claimId).toBeNull();
      expect(stored.claimExpiresAt).toBeNull();
      expect(await repository.claimNext()).toBeNull();
    });
  });

  it('recovers an expired claim and rejects its former owner', async () => {
    await withEvent(async (eventId) => {
      const first = await repository.claimNext();

      if (!first?.claimId) {
        throw new Error('Expected first claim');
      }

      await database.outboxEvent.update({
        where: { eventId },
        data: { claimExpiresAt: new Date('2000-01-01T00:00:00Z') },
      });

      expect(await repository.markPublished(eventId, first.claimId)).toBe(
        false,
      );

      const second = await repository.claimNext();

      if (!second?.claimId) {
        throw new Error('Expected replacement claim');
      }

      expect(second.claimId).not.toBe(first.claimId);
      expect(second.attempts).toBe(2);

      expect(await repository.recordFailure(eventId, first.claimId)).toBe(
        false,
      );

      expect(await repository.markPublished(eventId, second.claimId)).toBe(
        true,
      );
    });
  });

  it('schedules a retry without marking the event delivered', async () => {
    await withEvent(async (eventId) => {
      const claim = await repository.claimNext();

      if (!claim?.claimId) {
        throw new Error('Expected a claim');
      }

      expect(await repository.recordFailure(eventId, claim.claimId)).toBe(true);

      const stored = await database.outboxEvent.findUniqueOrThrow({
        where: { eventId },
      });

      expect(stored.publishedAt).toBeNull();
      expect(stored.failedAt).toBeNull();
      expect(stored.claimId).toBeNull();
      expect(stored.claimExpiresAt).toBeNull();
      expect(stored.attempts).toBe(1);

      const [clock] = await database.$queryRaw<{ pending: boolean }[]>`
        SELECT "nextAttemptAt" > statement_timestamp() AS pending
        FROM "OutboxEvent"
        WHERE "eventId" = ${eventId}::uuid
      `;

      expect(clock.pending).toBe(true);
    });
  });

  it('stops after the sixth failed attempt', async () => {
    await withEvent(async (eventId) => {
      await database.outboxEvent.update({
        where: { eventId },
        data: { attempts: 5 },
      });

      const claim = await repository.claimNext();

      if (!claim?.claimId) {
        throw new Error('Expected final claim');
      }

      expect(claim.attempts).toBe(6);
      expect(await repository.recordFailure(eventId, claim.claimId)).toBe(true);

      const stored = await database.outboxEvent.findUniqueOrThrow({
        where: { eventId },
      });

      expect(stored.failedAt).toBeInstanceOf(Date);
      expect(stored.publishedAt).toBeNull();
      expect(stored.claimId).toBeNull();
      expect(await repository.claimNext()).toBeNull();
    });
  });

  it('recovers an exhausted event after its final worker crashes', async () => {
    await withEvent(async (eventId) => {
      await database.outboxEvent.update({
        where: { eventId },
        data: {
          attempts: 6,
          claimId: randomUUID(),
          claimExpiresAt: new Date('2000-01-01T00:00:00Z'),
        },
      });

      expect(await repository.claimNext()).toBeNull();

      const stored = await database.outboxEvent.findUniqueOrThrow({
        where: { eventId },
      });

      expect(stored.failedAt).toBeInstanceOf(Date);
      expect(stored.claimId).toBeNull();
      expect(stored.claimExpiresAt).toBeNull();
      expect(stored.publishedAt).toBeNull();
    });
  });

  it('stops immediately for a non-retryable failure', async () => {
    await withEvent(async (eventId) => {
      const claim = await repository.claimNext();

      if (!claim?.claimId) {
        throw new Error('Expected a claim');
      }

      expect(
        await repository.recordFailure(eventId, claim.claimId, false),
      ).toBe(true);

      const stored = await database.outboxEvent.findUniqueOrThrow({
        where: { eventId },
      });

      expect(stored.attempts).toBe(1);
      expect(stored.failedAt).toBeInstanceOf(Date);
      expect(stored.publishedAt).toBeNull();
      expect(stored.claimId).toBeNull();
      expect(stored.claimExpiresAt).toBeNull();
      expect(await repository.claimNext()).toBeNull();
    });
  });

  it('blocks later versions until the earlier event is published', async () => {
    await withEvent(async (eventId) => {
      const earlier = await database.outboxEvent.findUniqueOrThrow({
        where: { eventId },
      });
      const laterId = randomUUID();

      try {
        await database.outboxEvent.create({
          data: {
            eventId: laterId,
            eventType: 'TEST_LATER_EVENT',
            schemaVersion: 1,
            producer: 'payment',
            aggregateId: earlier.aggregateId,
            aggregateVersion: earlier.aggregateVersion + 1,
            occurredAt: new Date(),
            correlationId: randomUUID(),
            data: {},
          },
        });

        const first = await repository.claimNext();

        if (!first?.claimId) {
          throw new Error('Expected earlier event claim');
        }

        expect(first.eventId).toBe(eventId);

        // An active earlier claim blocks the later version.
        expect(await repository.claimNext()).toBeNull();

        await repository.recordFailure(eventId, first.claimId, false);

        // A failed earlier event also blocks the later version.
        expect(await repository.claimNext()).toBeNull();

        // Test-only recovery: make the earlier event eligible again.
        await database.outboxEvent.update({
          where: { eventId },
          data: {
            failedAt: null,
            nextAttemptAt: new Date('2000-01-01T00:00:00Z'),
          },
        });

        const recovered = await repository.claimNext();

        if (!recovered?.claimId) {
          throw new Error('Expected recovered claim');
        }

        expect(recovered.eventId).toBe(eventId);
        expect(await repository.markPublished(eventId, recovered.claimId)).toBe(
          true,
        );

        const next = await repository.claimNext();

        expect(next?.eventId).toBe(laterId);
      } finally {
        await database.outboxEvent.deleteMany({
          where: { eventId: laterId },
        });
      }
    });
  });
});
