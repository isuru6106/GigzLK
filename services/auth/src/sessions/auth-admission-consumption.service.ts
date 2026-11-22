import { ConflictException, Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseService } from '../database.service';
import type { AuthRecoveryAuthority } from './auth-session-recovery.service';
import {
  admissionUnavailable,
  lockAdmissionControl,
} from './auth-admission-lock';

type ConsumptionInput = AuthRecoveryAuthority & {
  namespaceId: string;
  attemptComponent: string;
  authorization: string;
};

type ConsumptionResult =
  | {
      status: 'ADMITTED';
      attemptId: string;
      verificationClaim: string;
      issuanceExpiresAt: Date;
    }
  | {
      status: 'EXISTING';
      attemptId: string;
      issuanceExpiresAt: Date;
    };

@Injectable()
export class AuthAdmissionConsumptionService {
  constructor(private readonly database: DatabaseService) {}

  async consume(input: ConsumptionInput): Promise<ConsumptionResult> {
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
      typeof input.authorization !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.authorization)
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

    const presentedHash = createHash('sha256')
      .update(input.authorization)
      .digest();

    try {
      return await this.database.client.$transaction(async (transaction) => {
        // Serializes consumption with reservation cancellation and epochs.
        const control = await lockAdmissionControl(transaction);

        const reservation =
          await transaction.authAdmissionReservation.findUnique({
            where: {
              namespaceId_attemptComponent: {
                namespaceId: binding.namespaceId,
                attemptComponent: binding.attemptComponent,
              },
            },
            include: {
              namespace: true,
              attempt: true,
            },
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

        if (!/^[0-9a-f]{64}$/.test(reservation.authorizationHash)) {
          throw admissionUnavailable();
        }

        const storedHash = Buffer.from(reservation.authorizationHash, 'hex');

        if (!timingSafeEqual(storedHash, presentedHash)) {
          throw this.unresolved();
        }

        // Refresh time after the reservation lookup.
        const clocks = await transaction.$queryRaw<{ now: Date }[]>`
          SELECT clock_timestamp() AS "now"
        `;
        const now = clocks[0]?.now;

        if (!(now instanceof Date) || !Number.isSafeInteger(now.getTime())) {
          throw admissionUnavailable();
        }

        if (
          now.getTime() < reservation.createdAt.getTime() ||
          reservation.authorizationExpiresAt.getTime() <= now.getTime() ||
          reservation.issuanceExpiresAt.getTime() <= now.getTime()
        ) {
          throw this.unresolved();
        }

        if (reservation.state === 'CONSUMED') {
          const attempt = reservation.attempt;

          if (
            !attempt ||
            attempt.callerIssuer !== binding.callerIssuer ||
            attempt.audience !== binding.audience ||
            attempt.contextBinding !== binding.contextBinding ||
            attempt.issuanceExpiresAt.getTime() !==
              reservation.issuanceExpiresAt.getTime() ||
            !attempt.verificationClaimHash ||
            !attempt.verificationClaimedAt
          ) {
            throw admissionUnavailable();
          }

          if (attempt.state !== 'ADMITTED' && attempt.state !== 'COMMITTED') {
            throw this.unresolved();
          }

          // A duplicate never receives the original claim or a new one.
          return {
            status: 'EXISTING' as const,
            attemptId: attempt.id,
            issuanceExpiresAt: attempt.issuanceExpiresAt,
          };
        }

        if (reservation.state !== 'RESERVED') {
          throw this.unresolved();
        }

        if (reservation.attempt) {
          throw admissionUnavailable();
        }

        const verificationClaim = randomBytes(32).toString('base64url');
        const verificationClaimHash = createHash('sha256')
          .update(verificationClaim)
          .digest('hex');

        const attempt = await transaction.authLoginAttempt.create({
          data: {
            reservationId: reservation.id,
            callerIssuer: binding.callerIssuer,
            audience: binding.audience,
            contextBinding: binding.contextBinding,
            state: 'ADMITTED',
            admittedAt: now,
            issuanceExpiresAt: reservation.issuanceExpiresAt,
            recoveryExpiresAt: reservation.recoveryExpiresAt,
            verificationClaimHash,
            verificationClaimedAt: now,
          },
          select: {
            id: true,
            issuanceExpiresAt: true,
          },
        });

        await transaction.authAdmissionReservation.update({
          where: { id: reservation.id },
          data: {
            state: 'CONSUMED',
            consumedAt: now,
          },
        });

        return {
          status: 'ADMITTED' as const,
          attemptId: attempt.id,
          verificationClaim,
          issuanceExpiresAt: attempt.issuanceExpiresAt,
        };
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
