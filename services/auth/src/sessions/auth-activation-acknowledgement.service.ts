import { ConflictException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import type { AuthRecoveryAuthority } from './auth-session-recovery.service';
import {
  admissionUnavailable,
  lockAdmissionControl,
} from './auth-admission-lock';

type AcknowledgementInput = AuthRecoveryAuthority & {
  namespaceId: string;
  attemptComponent: string;
  attemptId: string;
  sessionId: string;
  activationId: string;
};

type LockedAttempt = {
  id: string;
  reservationId: string | null;
  callerIssuer: string;
  audience: string;
  contextBinding: string;
  state: string;
};

type LockedSession = {
  id: string;
  loginAttemptId: string | null;
  audience: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

type Confirmation = {
  status: 'ACTIVATION_ACKNOWLEDGED';
  acknowledgedAt: Date;
  sessionExpiresAt: Date;
  // Historical acknowledgement never authorizes cookie delivery.
  sessionStatus: 'UNREVOKED_AT_CHECK' | 'REVOKED' | 'EXPIRED' | 'UNKNOWN';
};

@Injectable()
export class AuthActivationAcknowledgementService {
  constructor(private readonly database: DatabaseService) {}

  // Internal primitive only. Authority must be independently authenticated
  // and authorized. No browser route or cookie behavior is enabled.
  async acknowledge(input: AcknowledgementInput): Promise<Confirmation> {
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
      !validUuid(input.attemptComponent) ||
      !validUuid(input.attemptId) ||
      !validUuid(input.sessionId) ||
      typeof input.activationId !== 'string' ||
      !/^[0-9a-f]{64}$/.test(input.activationId)
    ) {
      throw this.unresolved();
    }

    // Snapshot caller-owned values before asynchronous work.
    const binding = {
      callerIssuer: input.callerIssuer,
      contextBinding: input.contextBinding,
      namespaceId: input.namespaceId,
      attemptComponent: input.attemptComponent,
      attemptId: input.attemptId,
      sessionId: input.sessionId,
      activationId: input.activationId,
    };

    try {
      return await this.database.client.$transaction(async (transaction) => {
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
          reservation.audience !== 'MARKETPLACE' ||
          reservation.contextBinding !== binding.contextBinding ||
          reservation.operation !== '/internal/v1/auth/login'
        ) {
          throw this.unresolved();
        }

        // Hourly namespace closure does not invalidate an existing issuance.
        const attempts = await transaction.$queryRaw<LockedAttempt[]>`
          SELECT
            "id", "reservationId", "callerIssuer", "audience",
            "contextBinding", "state"
          FROM "AuthLoginAttempt"
          WHERE "id" = ${binding.attemptId}::uuid
          FOR UPDATE
        `;

        const attempt = attempts[0];

        if (
          !attempt ||
          attempt.reservationId !== reservation.id ||
          attempt.callerIssuer !== binding.callerIssuer ||
          attempt.audience !== 'MARKETPLACE' ||
          attempt.contextBinding !== binding.contextBinding
        ) {
          throw this.unresolved();
        }

        // Lock order: control, attempt, session.
        const sessions = await transaction.$queryRaw<LockedSession[]>`
          SELECT
            "id", "loginAttemptId", "audience", "expiresAt", "revokedAt"
          FROM "AuthSession"
          WHERE "id" = ${binding.sessionId}::uuid
          FOR UPDATE
        `;

        const session = sessions[0];

        if (
          session &&
          (session.loginAttemptId !== attempt.id ||
            session.audience !== 'MARKETPLACE')
        ) {
          throw this.unresolved();
        }

        const clocks = await transaction.$queryRaw<{ now: Date }[]>`
          SELECT clock_timestamp() AS "now"
        `;
        const now = clocks[0]?.now;

        if (
          !(now instanceof Date) ||
          !Number.isSafeInteger(now.getTime()) ||
          now.getTime() < control.now.getTime()
        ) {
          throw admissionUnavailable();
        }

        if (reservation.activationAcknowledgedAt !== null) {
          const acknowledgedAt = reservation.activationAcknowledgedAt;
          const sessionExpiresAt = reservation.activationSessionExpiresAt;
          const confirmationUntil = reservation.activationConfirmationUntil;

          if (
            reservation.activationId !== binding.activationId ||
            reservation.activationSessionId !== binding.sessionId
          ) {
            throw this.unresolved();
          }

          if (
            !sessionExpiresAt ||
            !confirmationUntil ||
            acknowledgedAt.getTime() > now.getTime() ||
            (session &&
              session.expiresAt.getTime() !== sessionExpiresAt.getTime())
          ) {
            throw admissionUnavailable();
          }

          if (
            now.getTime() >= confirmationUntil.getTime() &&
            !reservation.reconciliationPending
          ) {
            throw this.unresolved();
          }

          return {
            status: 'ACTIVATION_ACKNOWLEDGED' as const,
            acknowledgedAt,
            sessionExpiresAt,
            sessionStatus: !session
              ? ('UNKNOWN' as const)
              : session.revokedAt !== null
                ? ('REVOKED' as const)
                : session.expiresAt.getTime() <= now.getTime()
                  ? ('EXPIRED' as const)
                  : ('UNREVOKED_AT_CHECK' as const),
          };
        }

        if (
          reservation.state !== 'CONSUMED' ||
          reservation.cancelledAt !== null ||
          reservation.consumedAt === null ||
          attempt.state !== 'COMMITTED' ||
          !session ||
          session.revokedAt !== null ||
          reservation.createdAt.getTime() > now.getTime() ||
          reservation.consumedAt.getTime() > now.getTime() ||
          reservation.recoveryExpiresAt.getTime() <= now.getTime() ||
          session.expiresAt.getTime() <= now.getTime()
        ) {
          throw this.unresolved();
        }

        // Check deadlines again in the durable transition statement.
        // Materialize one database timestamp for all acknowledgement fields.
        const recorded = await transaction.$queryRaw<
          {
            activationAcknowledgedAt: Date;
            activationSessionExpiresAt: Date;
          }[]
        >`
          WITH stamp AS MATERIALIZED (
            SELECT clock_timestamp() AS "now"
          )
          UPDATE "AuthAdmissionReservation" r
          SET
            "activationId" = ${binding.activationId},
            "activationAcknowledgedAt" = stamp."now",
            "activationSessionId" = ${binding.sessionId}::uuid,
            "activationSessionExpiresAt" = ${session.expiresAt}::timestamptz,
            "activationConfirmationUntil" =
              ${session.expiresAt}::timestamptz + INTERVAL '24 hours'
          FROM stamp
          WHERE r."id" = ${reservation.id}::uuid
            AND r."state" = 'CONSUMED'
            AND r."cancelledAt" IS NULL
            AND r."activationAcknowledgedAt" IS NULL
            AND r."recoveryExpiresAt" > stamp."now"
            AND ${session.expiresAt}::timestamptz > stamp."now"
            AND EXISTS (
              SELECT 1
              FROM "AuthAdmissionControl" c
              WHERE c."id" = 'admission'
                AND c."enabled" = true
                AND c."epoch" = ${control.epoch}::uuid
            )
          RETURNING
            r."activationAcknowledgedAt",
            r."activationSessionExpiresAt"
        `;

        if (recorded.length !== 1) {
          throw this.unresolved();
        }

        // Preserve reconciliationPending: acknowledgement must not silently
        // clear independently outstanding reconciliation or outbox work.
        return {
          status: 'ACTIVATION_ACKNOWLEDGED' as const,
          acknowledgedAt: recorded[0].activationAcknowledgedAt,
          sessionExpiresAt: recorded[0].activationSessionExpiresAt,
          sessionStatus: 'UNREVOKED_AT_CHECK' as const,
        };
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }

      // Includes persistence failure and uncertain commit acknowledgement.
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
