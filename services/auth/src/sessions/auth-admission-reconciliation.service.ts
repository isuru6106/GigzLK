import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import {
  admissionUnavailable,
  lockAdmissionControl,
} from './auth-admission-lock';

const RECONCILIATION_BATCH_SIZE = 100;

@Injectable()
export class AuthAdmissionReconciliationService {
  constructor(private readonly database: DatabaseService) {}

  // Internal maintenance only. Never expose this as browser recovery.
  // The global control lock serializes concurrent batch workers.
  async runBatch(): Promise<{ resolvedReservations: number }> {
    try {
      return await this.database.client.$transaction(async (transaction) => {
        const control = await lockAdmissionControl(transaction);

        const reservations =
          await transaction.authAdmissionReservation.findMany({
            where: {
              namespace: { epoch: control.epoch },
              reconciliationPending: true,
              recoveryExpiresAt: { lte: control.now },
              issuanceExpiresAt: { lte: control.now },
            },
            orderBy: [{ recoveryExpiresAt: 'asc' }, { id: 'asc' }],
            take: RECONCILIATION_BATCH_SIZE,
            select: {
              id: true,
              callerIssuer: true,
              audience: true,
              contextBinding: true,
              createdAt: true,
              consumedAt: true,
              state: true,
            },
          });

        let resolvedReservations = 0;

        for (const reservation of reservations) {
          // Existing attempt operations also acquire this row lock.
          const attempts = await transaction.$queryRaw<
            {
              id: string;
              callerIssuer: string;
              audience: string;
              contextBinding: string;
              state: string;
              admittedAt: Date;
            }[]
          >`
            SELECT
              "id",
              "callerIssuer",
              "audience",
              "contextBinding",
              "state",
              "admittedAt"
            FROM "AuthLoginAttempt"
            WHERE "reservationId" = ${reservation.id}::uuid
            FOR UPDATE
          `;

          const attempt = attempts[0];

          if (
            reservation.createdAt.getTime() > control.now.getTime() ||
            (reservation.consumedAt !== null && !attempt) ||
            (reservation.consumedAt === null && attempt)
          ) {
            throw admissionUnavailable();
          }

          if (attempt) {
            if (
              attempt.callerIssuer !== reservation.callerIssuer ||
              attempt.audience !== reservation.audience ||
              attempt.contextBinding !== reservation.contextBinding ||
              attempt.admittedAt.getTime() > control.now.getTime() ||
              ![
                'ADMITTED',
                'COMMITTED',
                'CANCELLED',
                'REJECTED',
                'EXPIRED',
              ].includes(attempt.state)
            ) {
              throw admissionUnavailable();
            }

            const session = await transaction.authSession.findUnique({
              where: { loginAttemptId: attempt.id },
              select: {
                id: true,
                audience: true,
              },
            });

            if (
              (attempt.state === 'COMMITTED' && !session) ||
              (session && session.audience !== reservation.audience)
            ) {
              throw admissionUnavailable();
            }

            if (session) {
              await transaction.authSession.updateMany({
                where: {
                  id: session.id,
                  loginAttemptId: attempt.id,
                  audience: reservation.audience,
                  revokedAt: null,
                },
                data: { revokedAt: control.now },
              });
            }

            if (attempt.state !== 'CANCELLED') {
              await transaction.authLoginAttempt.update({
                where: { id: attempt.id },
                data: {
                  state: 'CANCELLED',
                  cancelledAt: control.now,
                },
              });
            }
          }

          await transaction.authAdmissionReservation.update({
            where: { id: reservation.id },
            data:
              reservation.state === 'CANCELLED'
                ? { reconciliationPending: false }
                : {
                    state: 'CANCELLED',
                    cancelledAt: control.now,
                    reconciliationPending: false,
                  },
          });

          resolvedReservations += 1;
        }

        return { resolvedReservations };
      });
    } catch {
      throw admissionUnavailable();
    }
  }
}
