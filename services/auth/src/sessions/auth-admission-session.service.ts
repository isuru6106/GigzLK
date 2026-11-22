import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseService } from '../database.service';
import type { ValidatedCredentials } from '../credentials/credentials.service';
import type { AuthRecoveryAuthority } from './auth-session-recovery.service';
import {
  admissionUnavailable,
  lockAdmissionControl,
} from './auth-admission-lock';

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

type SessionInput = AuthRecoveryAuthority & {
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
  verificationStartedAt: Date | null;
};

type LockedAccount = {
  id: string;
  status: string;
  emailVerifiedAt: Date | null;
  credentialVersion: number;
};

@Injectable()
export class AuthAdmissionSessionService {
  constructor(private readonly database: DatabaseService) {}

  // Internal session-storage primitive, not complete credential issuance.
  // Credentials must be the result of the authorized verification run.
  async create(
    input: SessionInput,
    credentials: ValidatedCredentials,
  ): Promise<{
    sessionId: string;
    audience: 'marketplace';
    sessionExpiresAt: Date;
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
      !validUuid(input.attemptComponent) ||
      !validUuid(input.attemptId) ||
      typeof input.verificationClaim !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.verificationClaim)
    ) {
      throw this.unresolved();
    }

    const binding = {
      callerIssuer: input.callerIssuer,
      contextBinding: input.contextBinding,
      namespaceId: input.namespaceId,
      attemptComponent: input.attemptComponent,
      attemptId: input.attemptId,
    };

    const claimHash = createHash('sha256')
      .update(input.verificationClaim)
      .digest();

    const accountId = credentials?.accountId;
    const credentialVersion = credentials?.credentialVersion;
    const authenticatedAtMs =
      credentials?.authenticatedAt instanceof Date
        ? credentials.authenticatedAt.getTime()
        : NaN;

    if (
      !validUuid(accountId) ||
      !Number.isSafeInteger(credentialVersion) ||
      credentialVersion < 1 ||
      !Number.isSafeInteger(authenticatedAtMs) ||
      authenticatedAtMs < 0
    ) {
      throw admissionUnavailable();
    }

    const expiresAt = new Date(authenticatedAtMs + SESSION_LIFETIME_MS);

    try {
      return await this.database.client.$transaction(async (transaction) => {
        // Epoch changes cannot commit while this transaction holds the lock.
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
          reservation.operation !== '/internal/v1/auth/login' ||
          reservation.state !== 'CONSUMED'
        ) {
          throw this.unresolved();
        }

        const attempts = await transaction.$queryRaw<LockedAttempt[]>`
          SELECT
            "id", "reservationId", "callerIssuer", "audience",
            "contextBinding", "state", "issuanceExpiresAt",
            "verificationClaimHash", "verificationStartedAt"
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
          attempt.contextBinding !== binding.contextBinding ||
          attempt.state !== 'ADMITTED' ||
          !attempt.verificationStartedAt
        ) {
          throw this.unresolved();
        }

        if (
          !attempt.verificationClaimHash ||
          !/^[0-9a-f]{64}$/.test(attempt.verificationClaimHash) ||
          attempt.issuanceExpiresAt.getTime() !==
            reservation.issuanceExpiresAt.getTime()
        ) {
          throw admissionUnavailable();
        }

        if (
          !timingSafeEqual(
            Buffer.from(attempt.verificationClaimHash, 'hex'),
            claimHash,
          ) ||
          authenticatedAtMs < attempt.verificationStartedAt.getTime()
        ) {
          throw this.unresolved();
        }

        const accounts = await transaction.$queryRaw<LockedAccount[]>`
          SELECT "id", "status", "emailVerifiedAt", "credentialVersion"
          FROM "Account"
          WHERE "id" = ${accountId}::uuid
          FOR UPDATE
        `;

        const account = accounts[0];

        if (
          !account ||
          account.status !== 'ACTIVE' ||
          account.emailVerifiedAt === null ||
          account.credentialVersion !== credentialVersion
        ) {
          throw new UnauthorizedException({
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password.',
          });
        }

        const clocks = await transaction.$queryRaw<{ now: Date }[]>`
          SELECT clock_timestamp() AS "now"
        `;
        const createdAt = clocks[0]?.now;

        if (
          !(createdAt instanceof Date) ||
          !Number.isSafeInteger(createdAt.getTime())
        ) {
          throw admissionUnavailable();
        }

        if (
          authenticatedAtMs > createdAt.getTime() ||
          expiresAt.getTime() <= createdAt.getTime() ||
          reservation.issuanceExpiresAt.getTime() <= createdAt.getTime()
        ) {
          throw this.unresolved();
        }

        const session = await transaction.authSession.create({
          data: {
            accountId,
            audience: 'MARKETPLACE',
            loginAttemptId: binding.attemptId,
            authenticatedAt: new Date(authenticatedAtMs),
            createdAt,
            expiresAt,
          },
          select: {
            id: true,
            expiresAt: true,
          },
        });

        // Evaluate expiry in the final transition statement itself.
        // A rejected transition rolls back the session insert.
        const committed = await transaction.$executeRaw`
          UPDATE "AuthLoginAttempt"
          SET "state" = 'COMMITTED'
          WHERE "id" = ${binding.attemptId}::uuid
            AND "reservationId" = ${reservation.id}::uuid
            AND "state" = 'ADMITTED'
            AND "issuanceExpiresAt" > clock_timestamp()
            AND ${expiresAt}::timestamptz > clock_timestamp()
            AND EXISTS (
              SELECT 1
              FROM "AuthAdmissionControl"
              WHERE "id" = 'admission'
                AND "enabled" = true
                AND "epoch" = ${control.epoch}::uuid
            )
        `;

        if (committed !== 1) {
          throw this.unresolved();
        }

        return {
          sessionId: session.id,
          audience: 'marketplace' as const,
          sessionExpiresAt: session.expiresAt,
        };
      });
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof UnauthorizedException
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
}
