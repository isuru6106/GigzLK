import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseService } from '../database.service';
import type { AuthRecoveryAuthority } from './auth-session-recovery.service';
import {
  admissionUnavailable,
  lockAdmissionControl,
} from './auth-admission-lock';

const LOGIN_OPERATION = '/internal/v1/auth/login';
const ISSUANCE_MS = 5 * 60 * 1000;
const RECOVERY_MS = 24 * 60 * 60 * 1000;
const CONTEXT_WINDOW_MS = 10 * 60 * 1000;

type ReservationInput = AuthRecoveryAuthority & {
  namespaceId: string;
  attemptComponent: string;
};

@Injectable()
export class AuthAdmissionReservationService {
  constructor(private readonly database: DatabaseService) {}

  async reserve(input: ReservationInput): Promise<{
    namespaceId: string;
    attemptComponent: string;
    authorization: string;
    authorizationExpiresAt: Date;
    issuanceExpiresAt: Date;
    recoveryExpiresAt: Date;
  }> {
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
        const control = await lockAdmissionControl(transaction);

        const namespace = await transaction.authAdmissionNamespace.findUnique({
          where: { id: binding.namespaceId },
        });

        if (!namespace || namespace.epoch !== control.epoch) {
          throw this.unresolved();
        }

        const existing = await transaction.authAdmissionReservation.findUnique({
          where: {
            namespaceId_attemptComponent: {
              namespaceId: binding.namespaceId,
              attemptComponent: binding.attemptComponent,
            },
          },
          select: { id: true },
        });

        // Hash-only storage cannot replay the original authorization.
        // Never replace it or extend its deadlines.
        if (existing) {
          throw this.unresolved();
        }

        if (
          namespace.closedAt !== null ||
          namespace.hour !== control.activeHour ||
          namespace.hour <= control.closedThroughHour
        ) {
          throw this.unresolved();
        }

        const contextWhere = {
          callerIssuer: binding.callerIssuer,
          audience: binding.audience,
          contextBinding: binding.contextBinding,
        };

        const pending = await transaction.authAdmissionReservation.count({
          where: {
            ...contextWhere,
            OR: [
              { reconciliationPending: true },
              {
                state: { in: ['RESERVED', 'CONSUMED'] },
                issuanceExpiresAt: { gt: control.now },
              },
            ],
          },
        });

        if (pending > 0) {
          throw this.unresolved();
        }

        const recent = await transaction.authAdmissionReservation.count({
          where: {
            ...contextWhere,
            createdAt: {
              gt: new Date(control.now.getTime() - CONTEXT_WINDOW_MS),
            },
          },
        });

        if (recent >= 3) {
          throw this.rateLimited();
        }

        const outstanding = await transaction.authAdmissionReservation.count({
          where: {
            callerIssuer: binding.callerIssuer,
            state: { in: ['RESERVED', 'CONSUMED'] },
            issuanceExpiresAt: { gt: control.now },
          },
        });

        if (outstanding >= 100) {
          throw this.rateLimited();
        }

        const callerRecords = await transaction.authAdmissionReservation.count({
          where: { callerIssuer: binding.callerIssuer },
        });

        const totalRecords = await transaction.authAdmissionReservation.count();

        if (callerRecords >= 50_000 || totalRecords >= 100_000) {
          throw admissionUnavailable();
        }

        const quota = await transaction.authAdmissionCallerQuota.findUnique({
          where: { callerIssuer: binding.callerIssuer },
        });

        let tokens = 5;

        if (quota) {
          if (
            !Number.isFinite(quota.tokens) ||
            quota.tokens < 0 ||
            quota.tokens > 5 ||
            quota.refilledAt.getTime() > control.now.getTime()
          ) {
            throw admissionUnavailable();
          }

          const elapsedMs = control.now.getTime() - quota.refilledAt.getTime();

          // Ten tokens per minute, with a maximum burst of five.
          tokens = Math.min(5, quota.tokens + elapsedMs / 6000);
        }

        if (tokens < 1) {
          throw this.rateLimited();
        }

        await transaction.authAdmissionCallerQuota.upsert({
          where: { callerIssuer: binding.callerIssuer },
          create: {
            callerIssuer: binding.callerIssuer,
            tokens: tokens - 1,
            refilledAt: control.now,
          },
          update: {
            tokens: tokens - 1,
            refilledAt: control.now,
          },
        });

        const authorization = randomBytes(32).toString('base64url');
        const authorizationHash = createHash('sha256')
          .update(authorization)
          .digest('hex');

        const issuanceExpiresAt = new Date(control.now.getTime() + ISSUANCE_MS);
        const recoveryExpiresAt = new Date(control.now.getTime() + RECOVERY_MS);

        await transaction.authAdmissionReservation.create({
          data: {
            ...binding,
            operation: LOGIN_OPERATION,
            authorizationHash,
            state: 'RESERVED',
            createdAt: control.now,
            authorizationExpiresAt: issuanceExpiresAt,
            issuanceExpiresAt,
            recoveryExpiresAt,

            // Recovery must explicitly resolve the reservation.
            // Expiry alone must not authorize a replacement.
            reconciliationPending: true,
          },
        });

        return {
          namespaceId: binding.namespaceId,
          attemptComponent: binding.attemptComponent,
          authorization,
          authorizationExpiresAt: new Date(issuanceExpiresAt.getTime()),
          issuanceExpiresAt,
          recoveryExpiresAt,
        };
      });
    } catch (error) {
      if (
        error instanceof ConflictException ||
        (error instanceof HttpException && error.getStatus() === 429)
      ) {
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

  private rateLimited(): HttpException {
    return new HttpException(
      {
        code: 'RATE_LIMITED',
        message: 'Too many authentication requests.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
