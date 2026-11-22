import { ConflictException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import type { AuthRecoveryAuthority } from './auth-session-recovery.service';
import {
  admissionUnavailable,
  lockAdmissionControl,
} from './auth-admission-lock';

type CancellationInput = AuthRecoveryAuthority & {
  namespaceId: string;
  attemptComponent: string;
};

@Injectable()
export class AuthAdmissionCancellationService {
  constructor(private readonly database: DatabaseService) {}

  // Internal browser-recovery operation.
  // Background reconciliation after the recovery deadline needs a
  // separately authorized internal path.
  async cancel(input: CancellationInput): Promise<{ status: 'CANCELLED' }> {
    const validUuid = (value: unknown): value is string =>
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      );

    const validBinding = (value: unknown): value is string =>
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 255 &&
      value.trim() === value;

    if (
      !input ||
      input.audience !== 'MARKETPLACE' ||
      !validBinding(input.callerIssuer) ||
      !validBinding(input.contextBinding) ||
      !validUuid(input.namespaceId) ||
      !validUuid(input.attemptComponent)
    ) {
      throw this.unresolved();
    }

    const binding = {
      callerIssuer: input.callerIssuer,
      audience: input.audience,
      contextBinding: input.contextBinding,
      namespaceId: input.namespaceId,
      attemptComponent: input.attemptComponent,
    };

    try {
      return await this.database.client.$transaction(async (transaction) => {
        // Shared lock prevents consumption from racing cancellation.
        const control = await lockAdmissionControl(transaction);

        const reservation =
          await transaction.authAdmissionReservation.findUnique({
            where: {
              namespaceId_attemptComponent: {
                namespaceId: binding.namespaceId,
                attemptComponent: binding.attemptComponent,
              },
            },
            include: { namespace: true },
          });

        if (
          !reservation ||
          reservation.namespace.epoch !== control.epoch ||
          reservation.callerIssuer !== binding.callerIssuer ||
          reservation.audience !== binding.audience ||
          reservation.contextBinding !== binding.contextBinding ||
          reservation.operation !== '/internal/v1/auth/login'
        ) {
          throw this.unresolved();
        }

        const clocks = await transaction.$queryRaw<{ now: Date }[]>`
          SELECT clock_timestamp() AS "now"
        `;
        const now = clocks[0]?.now;

        if (!(now instanceof Date) || !Number.isSafeInteger(now.getTime())) {
          throw admissionUnavailable();
        }

        if (
          now.getTime() < reservation.createdAt.getTime() ||
          reservation.recoveryExpiresAt.getTime() <= now.getTime()
        ) {
          throw this.unresolved();
        }

        // Match the existing writer/recovery lock order:
        // control first, then attempt, then session updates.
        const attempts = await transaction.$queryRaw<
          {
            id: string;
            callerIssuer: string;
            audience: string;
            contextBinding: string;
            state: string;
          }[]
        >`
          SELECT
            "id",
            "callerIssuer",
            "audience",
            "contextBinding",
            "state"
          FROM "AuthLoginAttempt"
          WHERE "reservationId" = ${reservation.id}::uuid
          FOR UPDATE
        `;

        const attempt = attempts[0];

        if (
          (reservation.consumedAt !== null && !attempt) ||
          (reservation.consumedAt === null && attempt)
        ) {
          throw admissionUnavailable();
        }

        if (attempt) {
          if (
            attempt.callerIssuer !== binding.callerIssuer ||
            attempt.audience !== binding.audience ||
            attempt.contextBinding !== binding.contextBinding
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
            (session && session.audience !== binding.audience)
          ) {
            throw admissionUnavailable();
          }

          if (session) {
            await transaction.authSession.updateMany({
              where: {
                id: session.id,
                loginAttemptId: attempt.id,
                audience: binding.audience,
                revokedAt: null,
              },
              data: { revokedAt: now },
            });
          }

          if (attempt.state !== 'CANCELLED') {
            await transaction.authLoginAttempt.update({
              where: { id: attempt.id },
              data: {
                state: 'CANCELLED',
                cancelledAt: now,
              },
            });
          }
        }

        if (reservation.state !== 'CANCELLED') {
          await transaction.authAdmissionReservation.update({
            where: { id: reservation.id },
            data: {
              state: 'CANCELLED',
              cancelledAt: now,
              reconciliationPending: false,
            },
          });
        } else if (reservation.reconciliationPending) {
          await transaction.authAdmissionReservation.update({
            where: { id: reservation.id },
            data: { reconciliationPending: false },
          });
        }

        return { status: 'CANCELLED' as const };
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }

      throw admissionUnavailable();
    }
  }

  private unresolved(): ConflictException {
    return new ConflictException({
      code: 'AUTH_REFERENCE_UNRESOLVED',
      message: 'The authentication operation could not be resolved.',
    });
  }
}
