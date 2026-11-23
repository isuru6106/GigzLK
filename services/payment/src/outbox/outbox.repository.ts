import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database.service';
import type { OutboxEvent } from '../generated/prisma/client';

export class OutboxRepository {
  constructor(private readonly database: DatabaseService) {}

  async claimNext(): Promise<OutboxEvent | null> {
    const claimId = randomUUID();

    // Recover exhausted events after their final worker crashed.
    await this.database.$executeRaw`
      UPDATE "OutboxEvent"
      SET "failedAt" = statement_timestamp(),
          "claimId" = NULL,
          "claimExpiresAt" = NULL
      WHERE "publishedAt" IS NULL
        AND "failedAt" IS NULL
        AND "attempts" >= 6
        AND (
          "claimExpiresAt" IS NULL
          OR "claimExpiresAt" <= statement_timestamp()
        )
    `;

    const events = await this.database.$queryRaw<OutboxEvent[]>`
      WITH candidate AS (
        SELECT event."eventId"
        FROM "OutboxEvent" AS event
        WHERE event."publishedAt" IS NULL
          AND event."failedAt" IS NULL
          AND event."attempts" < 6
          AND event."nextAttemptAt" <= statement_timestamp()
          AND (
            event."claimExpiresAt" IS NULL
            OR event."claimExpiresAt" <= statement_timestamp()
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "OutboxEvent" AS earlier
            WHERE earlier."aggregateId" = event."aggregateId"
              AND earlier."aggregateVersion" < event."aggregateVersion"
              AND earlier."publishedAt" IS NULL
          )
        ORDER BY event."createdAt", event."eventId"
        LIMIT 1
        FOR UPDATE OF event SKIP LOCKED
      )
      UPDATE "OutboxEvent" AS event
      SET "claimId" = ${claimId}::uuid,
          "claimExpiresAt" =
            statement_timestamp() + INTERVAL '60 seconds',
          "attempts" = event."attempts" + 1
      FROM candidate
      WHERE event."eventId" = candidate."eventId"
      RETURNING event.*
    `;

    return events[0] ?? null;
  }

  async markPublished(eventId: string, claimId: string): Promise<boolean> {
    const changed = await this.database.$executeRaw`
      UPDATE "OutboxEvent"
      SET "publishedAt" = statement_timestamp(),
          "claimId" = NULL,
          "claimExpiresAt" = NULL
      WHERE "eventId" = ${eventId}::uuid
        AND "claimId" = ${claimId}::uuid
        AND "claimExpiresAt" > statement_timestamp()
        AND "publishedAt" IS NULL
        AND "failedAt" IS NULL
    `;

    return changed === 1;
  }

  async recordFailure(
    eventId: string,
    claimId: string,
    retryable = true,
  ): Promise<boolean> {
    const changed = await this.database.$executeRaw`
      UPDATE "OutboxEvent"
      SET "failedAt" = CASE
            WHEN "attempts" >= 6 OR NOT ${retryable}::boolean
              THEN statement_timestamp()
            ELSE NULL
          END,
          "nextAttemptAt" = statement_timestamp()
            + (
                LEAST(
                  300.0,
                  POWER(2.0, LEAST("attempts", 6))
                )
                * (0.5 + RANDOM() * 0.5)
              ) * INTERVAL '1 second',
          "claimId" = NULL,
          "claimExpiresAt" = NULL
      WHERE "eventId" = ${eventId}::uuid
        AND "claimId" = ${claimId}::uuid
        AND "claimExpiresAt" > statement_timestamp()
        AND "publishedAt" IS NULL
        AND "failedAt" IS NULL
    `;

    return changed === 1;
  }
}
