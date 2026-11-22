import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import {
  admissionUnavailable,
  lockAdmissionControl,
} from './auth-admission-lock';

const CLEANUP_BATCH_SIZE = 100;

@Injectable()
export class AuthAdmissionCleanupService {
  constructor(private readonly database: DatabaseService) {}

  // Internal maintenance operation. No HTTP route or scheduler is enabled.
  async runBatch(): Promise<{
    deletedAttempts: number;
    deletedReservations: number;
  }> {
    try {
      return await this.database.client.$transaction(async (transaction) => {
        const control = await lockAdmissionControl(transaction);

        const candidates = await transaction.$queryRaw<{ id: string }[]>`
          SELECT r."id"
          FROM "AuthAdmissionReservation" r
          JOIN "AuthAdmissionNamespace" n
            ON n."id" = r."namespaceId"
          LEFT JOIN "AuthLoginAttempt" a
            ON a."reservationId" = r."id"
          WHERE n."epoch" = ${control.epoch}::uuid
            AND n."hour" <= ${control.closedThroughHour}
            AND n."closedAt" IS NOT NULL
            AND n."closedAt" <=
              ${control.now}::timestamptz - INTERVAL '48 hours'
            AND r."recoveryExpiresAt" <= ${control.now}::timestamptz
            AND r."issuanceExpiresAt" <= ${control.now}::timestamptz
            AND r."reconciliationPending" = false
            AND r."state" IN ('CANCELLED', 'EXPIRED')
            AND (
              a."id" IS NULL
              OR (
                a."state" IN ('CANCELLED', 'REJECTED', 'EXPIRED')
                AND NOT EXISTS (
                  SELECT 1
                  FROM "AuthSession" s
                  WHERE s."loginAttemptId" = a."id"
                )
              )
            )
          ORDER BY r."recoveryExpiresAt", r."id"
          LIMIT ${CLEANUP_BATCH_SIZE}
          FOR UPDATE OF r
        `;

        const reservationIds = candidates.map((candidate) => candidate.id);

        if (reservationIds.length === 0) {
          return {
            deletedAttempts: 0,
            deletedReservations: 0,
          };
        }

        // Delete only terminal attempts with no associated session.
        const attempts = await transaction.authLoginAttempt.deleteMany({
          where: {
            reservationId: { in: reservationIds },
            state: { in: ['CANCELLED', 'REJECTED', 'EXPIRED'] },
            session: { is: null },
          },
        });

        // Recheck conditions instead of assuming every candidate is deletable.
        const reservations =
          await transaction.authAdmissionReservation.deleteMany({
            where: {
              id: { in: reservationIds },
              reconciliationPending: false,
              state: { in: ['CANCELLED', 'EXPIRED'] },
              recoveryExpiresAt: { lte: control.now },
              issuanceExpiresAt: { lte: control.now },
              attempt: { is: null },
            },
          });

        return {
          deletedAttempts: attempts.count,
          deletedReservations: reservations.count,
        };
      });
    } catch {
      throw admissionUnavailable();
    }
  }
}
