import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database.service';
import type { VerificationDeliveryResult } from './verification-delivery';
export class VerificationDeliveryRepository {
  constructor(private readonly database: DatabaseService) {}

  async claimNext() {
    const claimId = randomUUID();

    return this.database.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<Array<{ id: string }>>`
        WITH candidate AS (
          SELECT notification."id"
          FROM "VerificationNotification" AS notification
          WHERE notification."status" IN (
            'QUEUED'::"VerificationStatus",
            'RETRY_WAIT'::"VerificationStatus"
          )
            AND notification."deliveryOutcome" =
              'NOT_SENT'::"VerificationDeliveryOutcome"
            AND notification."cancellationRequested" = false
            AND notification."claimId" IS NULL
            AND notification."attempts" < 5
            AND notification."nextAttemptAt" <= statement_timestamp()
            AND notification."sendBefore" > statement_timestamp()
            AND EXISTS (
              SELECT 1
              FROM "VerificationPayload" AS payload
              WHERE payload."notificationId" = notification."id"
            )
          ORDER BY notification."createdAt", notification."id"
          LIMIT 1
          FOR UPDATE OF notification SKIP LOCKED
        )
        UPDATE "VerificationNotification" AS notification
        SET
          "status" = 'SENDING'::"VerificationStatus",
          "claimId" = ${claimId}::uuid,
          "claimExpiresAt" = statement_timestamp() + INTERVAL '60 seconds',
          "attempts" = notification."attempts" + 1,
          "updatedAt" = statement_timestamp()
        FROM candidate
        WHERE notification."id" = candidate."id"
        RETURNING notification."id"
      `;

      const selected = claimed[0];

      if (!selected) {
        return null;
      }

      return tx.verificationNotification.findUniqueOrThrow({
        where: { id: selected.id },
        include: { payload: true },
      });
    });
  }
  async recordResult(
    notificationId: string,
    claimId: string,
    result: VerificationDeliveryResult,
  ): Promise<boolean> {
    if (
      result.outcome === 'ACCEPTED' &&
      !/^[\x21-\x7E]{1,200}$/.test(result.providerReference)
    ) {
      throw new Error('Invalid verification provider reference');
    }

    return this.database.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          attempts: number;
          sendBefore: Date;
          expiresAt: Date;
          cancellationRequested: boolean;
          databaseNow: Date;
        }>
      >`
        SELECT
          "attempts",
          "sendBefore",
          "expiresAt",
          "cancellationRequested",
          clock_timestamp() AS "databaseNow"
        FROM "VerificationNotification"
        WHERE "id" = ${notificationId}::uuid
          AND "claimId" = ${claimId}::uuid
          AND "status" = 'SENDING'::"VerificationStatus"
          AND "claimExpiresAt" > clock_timestamp()
        FOR UPDATE
      `;

      const notification = rows[0];

      if (!notification) {
        return false;
      }

      const now = notification.databaseNow;
      const expired = notification.expiresAt.getTime() <= now.getTime();

      let status:
        | 'SENT'
        | 'FAILED'
        | 'CANCELLED'
        | 'EXPIRED'
        | 'RETRY_WAIT'
        | 'DELIVERY_UNKNOWN';

      let deliveryOutcome: 'ACCEPTED' | 'NOT_SENT' | 'MAY_HAVE_BEEN_SENT';

      let nextAttemptAt = now;
      let providerReference: string | null = null;

      if (result.outcome === 'ACCEPTED') {
        status = 'SENT';
        deliveryOutcome = 'ACCEPTED';
        providerReference = result.providerReference;
      } else if (result.outcome === 'MAY_HAVE_BEEN_SENT') {
        status = expired ? 'EXPIRED' : 'DELIVERY_UNKNOWN';
        deliveryOutcome = 'MAY_HAVE_BEEN_SENT';
      } else {
        deliveryOutcome = 'NOT_SENT';

        // Exponential backoff with up to one second of jitter.
        const retryDelay =
          1_000 * 2 ** Math.max(0, notification.attempts - 1) +
          Math.floor(Math.random() * 1_000);

        nextAttemptAt = new Date(now.getTime() + retryDelay);

        if (notification.cancellationRequested) {
          status = 'CANCELLED';
        } else if (expired) {
          status = 'EXPIRED';
        } else if (
          !result.retryable ||
          notification.attempts >= 5 ||
          nextAttemptAt.getTime() >= notification.sendBefore.getTime()
        ) {
          status = 'FAILED';
        } else {
          status = 'RETRY_WAIT';
        }
      }

      await tx.verificationNotification.update({
        where: { id: notificationId },
        data: {
          status,
          deliveryOutcome,
          providerReference,
          nextAttemptAt,
          claimId: null,
          claimExpiresAt: null,
        },
      });

      if (status !== 'RETRY_WAIT' && status !== 'DELIVERY_UNKNOWN') {
        await tx.verificationPayload.deleteMany({
          where: { notificationId },
        });
      }

      return true;
    });
  }
  async recoverUnavailable(): Promise<number> {
    return this.database.$transaction(async (tx) => {
      const recovered = await tx.$queryRaw<
        Array<{ id: string; status: string }>
      >`
        WITH candidates AS (
          SELECT notification."id"
          FROM "VerificationNotification" AS notification
          WHERE (
            notification."status" = 'SENDING'::"VerificationStatus"
            AND notification."claimExpiresAt" <= statement_timestamp()
          )
          OR (
            notification."status" = 'DELIVERY_UNKNOWN'::"VerificationStatus"
            AND notification."expiresAt" <= statement_timestamp()
          )
          OR (
            notification."status" IN (
              'QUEUED'::"VerificationStatus",
              'RETRY_WAIT'::"VerificationStatus"
            )
            AND (
              notification."cancellationRequested" = true
              OR notification."sendBefore" <= statement_timestamp()
              OR notification."attempts" >= 5
              OR NOT EXISTS (
                SELECT 1
                FROM "VerificationPayload" AS payload
                WHERE payload."notificationId" = notification."id"
              )
            )
          )
          ORDER BY notification."createdAt", notification."id"
          LIMIT 100
          FOR UPDATE OF notification SKIP LOCKED
        )
        UPDATE "VerificationNotification" AS notification
        SET
          "status" = CASE
            WHEN notification."status" IN (
              'SENDING'::"VerificationStatus",
              'DELIVERY_UNKNOWN'::"VerificationStatus"
            ) THEN
              CASE
                WHEN notification."expiresAt" <= statement_timestamp()
                  THEN 'EXPIRED'::"VerificationStatus"
                ELSE 'DELIVERY_UNKNOWN'::"VerificationStatus"
              END
            WHEN notification."cancellationRequested" = true
              THEN 'CANCELLED'::"VerificationStatus"
            WHEN notification."expiresAt" <= statement_timestamp()
              THEN 'EXPIRED'::"VerificationStatus"
            ELSE 'FAILED'::"VerificationStatus"
          END,
          "deliveryOutcome" = CASE
            WHEN notification."status" IN (
              'SENDING'::"VerificationStatus",
              'DELIVERY_UNKNOWN'::"VerificationStatus"
            )
              THEN 'MAY_HAVE_BEEN_SENT'::"VerificationDeliveryOutcome"
            ELSE notification."deliveryOutcome"
          END,
          "claimId" = NULL,
          "claimExpiresAt" = NULL,
          "updatedAt" = statement_timestamp()
        FROM candidates
        WHERE notification."id" = candidates."id"
        RETURNING notification."id", notification."status"
      `;

      const terminalIds = recovered
        .filter((notification) => notification.status !== 'DELIVERY_UNKNOWN')
        .map((notification) => notification.id);

      if (terminalIds.length > 0) {
        await tx.verificationPayload.deleteMany({
          where: {
            notificationId: { in: terminalIds },
          },
        });
      }

      return recovered.length;
    });
  }
  async cancel(callerId: string, notificationId: string): Promise<boolean> {
    return this.database.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT "status"
        FROM "VerificationNotification"
        WHERE "id" = ${notificationId}::uuid
          AND "callerId" = ${callerId}
        FOR UPDATE
      `;

      const notification = rows[0];

      if (!notification) {
        return false;
      }

      if (
        notification.status === 'QUEUED' ||
        notification.status === 'RETRY_WAIT'
      ) {
        await tx.verificationNotification.update({
          where: { id: notificationId },
          data: {
            status: 'CANCELLED',
            cancellationRequested: true,
            claimId: null,
            claimExpiresAt: null,
          },
        });

        await tx.verificationPayload.deleteMany({
          where: { notificationId },
        });
      } else if (
        notification.status === 'SENDING' ||
        notification.status === 'DELIVERY_UNKNOWN'
      ) {
        await tx.verificationNotification.update({
          where: { id: notificationId },
          data: {
            cancellationRequested: true,
          },
        });
      }

      return true;
    });
  }
  async deleteExpiredMetadata(): Promise<number> {
    const deleted = await this.database.$queryRaw<Array<{ id: string }>>`
      WITH candidates AS (
        SELECT notification."id"
        FROM "VerificationNotification" AS notification
        WHERE notification."metadataDeleteAfter" <= statement_timestamp()
          AND notification."status" IN (
            'SENT'::"VerificationStatus",
            'FAILED'::"VerificationStatus",
            'CANCELLED'::"VerificationStatus",
            'EXPIRED'::"VerificationStatus"
          )
          AND notification."claimId" IS NULL
        ORDER BY notification."metadataDeleteAfter", notification."id"
        LIMIT 100
        FOR UPDATE OF notification SKIP LOCKED
      )
      DELETE FROM "VerificationNotification" AS notification
      USING candidates
      WHERE notification."id" = candidates."id"
      RETURNING notification."id"
    `;

    return deleted.length;
  }
  async canDispatch(notificationId: string, claimId: string): Promise<boolean> {
    const rows = await this.database.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "VerificationNotification"
      WHERE "id" = ${notificationId}::uuid
        AND "claimId" = ${claimId}::uuid
        AND "status" = 'SENDING'::"VerificationStatus"
        AND "deliveryOutcome" = 'NOT_SENT'::"VerificationDeliveryOutcome"
        AND "cancellationRequested" = false
        AND "claimExpiresAt" > clock_timestamp()
        AND "sendBefore" > clock_timestamp()
    `;

    return rows.length === 1;
  }
}
