import { ConflictException, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseService } from '../database.service';
import type { AuthRecoveryAuthority } from './auth-session-recovery.service';
import {
  admissionUnavailable,
  lockAdmissionControl,
} from './auth-admission-lock';

type VerificationInput = AuthRecoveryAuthority & {
  namespaceId: string;
  attemptComponent: string;
  attemptId: string;
  verificationClaim: string;
};

type LockedAttempt = {
  id: string;
  reservationId: string | null;
  callerIssuer: string;
  audience: string;
  contextBinding: string;
  state: string;
  issuanceExpiresAt: Date;
  verificationClaimHash: string | null;
  verificationClaimedAt: Date | null;
  verificationStartedAt: Date | null;
};

@Injectable()
export class AuthAdmissionVerificationService {
  constructor(private readonly database: DatabaseService) {}

  // A successful return authorizes one in-process verification execution.
  // Do not automatically retry this operation or password verification.
  async start(input: VerificationInput): Promise<void> {
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
      typeof input.verificationClaim !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.verificationClaim)
    ) {
      throw this.unresolved();
    }

    const binding = {
      callerIssuer: input.callerIssuer,
      audience: input.audience,
      contextBinding: input.contextBinding,
      namespaceId: input.namespaceId,
      attemptComponent: input.attemptComponent,
      attemptId: input.attemptId,
    };

    const presentedHash = createHash('sha256')
      .update(input.verificationClaim)
      .digest();

    try {
      await this.database.client.$transaction(async (transaction) => {
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
          reservation.operation !== '/internal/v1/auth/login' ||
          reservation.state !== 'CONSUMED'
        ) {
          throw this.unresolved();
        }

        const attempts = await transaction.$queryRaw<LockedAttempt[]>`
          SELECT
            "id",
            "reservationId",
            "callerIssuer",
            "audience",
            "contextBinding",
            "state",
            "issuanceExpiresAt",
            "verificationClaimHash",
            "verificationClaimedAt",
            "verificationStartedAt"
          FROM "AuthLoginAttempt"
          WHERE "id" = ${binding.attemptId}::uuid
          FOR UPDATE
        `;

        const attempt = attempts[0];

        if (
          !attempt ||
          attempt.reservationId !== reservation.id ||
          attempt.callerIssuer !== binding.callerIssuer ||
          attempt.audience !== binding.audience ||
          attempt.contextBinding !== binding.contextBinding ||
          attempt.state !== 'ADMITTED' ||
          attempt.verificationStartedAt !== null
        ) {
          throw this.unresolved();
        }

        if (
          !attempt.verificationClaimHash ||
          !/^[0-9a-f]{64}$/.test(attempt.verificationClaimHash) ||
          !attempt.verificationClaimedAt ||
          attempt.issuanceExpiresAt.getTime() !==
            reservation.issuanceExpiresAt.getTime()
        ) {
          throw admissionUnavailable();
        }

        if (
          !timingSafeEqual(
            Buffer.from(attempt.verificationClaimHash, 'hex'),
            presentedHash,
          )
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
          now.getTime() < attempt.verificationClaimedAt.getTime() ||
          reservation.issuanceExpiresAt.getTime() <= now.getTime()
        ) {
          throw this.unresolved();
        }

        const started = await transaction.authLoginAttempt.updateMany({
          where: {
            id: binding.attemptId,
            reservationId: reservation.id,
            state: 'ADMITTED',
            verificationClaimHash: attempt.verificationClaimHash,
            verificationStartedAt: null,
          },
          data: { verificationStartedAt: now },
        });

        if (started.count !== 1) {
          throw this.unresolved();
        }
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
