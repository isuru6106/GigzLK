import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database.service';
import type { ValidatedCredentials } from '../credentials/credentials.service';
import type { AuthRecoveryAuthority } from './auth-session-recovery.service';

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

type LockedAttempt = {
  id: string;
  reservationId: string | null;
  callerIssuer: string;
  audience: string;
  contextBinding: string;
  state: string;
  issuanceExpiresAt: Date;
};

type LockedAccount = {
  id: string;
  status: string;
  emailVerifiedAt: Date | null;
  credentialVersion: number;
};

@Injectable()
export class AttemptSessionService {
  constructor(private readonly database: DatabaseService) {}

  // Internal storage primitive for attempts without admission reservations.
  // Credentials must come from successful password verification.
  // Authority must come from independently validated internal processing.
  async createForAttempt(
    authority: AuthRecoveryAuthority,
    attemptId: string,
    credentials: ValidatedCredentials,
  ): Promise<{
    sessionId: string;
    audience: 'marketplace';
    sessionExpiresAt: Date;
  }> {
    const validReference = (value: unknown): value is string =>
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
      !authority ||
      authority.audience !== 'MARKETPLACE' ||
      !validBinding(authority.callerIssuer) ||
      !validBinding(authority.contextBinding) ||
      !validReference(attemptId)
    ) {
      throw this.unresolved();
    }

    // Copy all caller-owned values before the first await.
    const callerIssuer = authority.callerIssuer;
    const contextBinding = authority.contextBinding;
    const accountId = credentials?.accountId;
    const credentialVersion = credentials?.credentialVersion;
    const authenticatedAtMs =
      credentials?.authenticatedAt instanceof Date
        ? credentials.authenticatedAt.getTime()
        : NaN;

    if (
      !validReference(accountId) ||
      !Number.isSafeInteger(credentialVersion) ||
      credentialVersion < 1 ||
      !Number.isSafeInteger(authenticatedAtMs) ||
      authenticatedAtMs < 0 ||
      authenticatedAtMs > Date.now()
    ) {
      throw this.unavailable();
    }

    const authenticatedAt = new Date(authenticatedAtMs);
    const expiresAt = new Date(authenticatedAtMs + SESSION_LIFETIME_MS);

    try {
      return await this.database.client.$transaction(async (transaction) => {
        const attempts = await transaction.$queryRaw<LockedAttempt[]>`
          SELECT
            "id",
            "reservationId",
            "callerIssuer",
            "audience",
            "contextBinding",
            "state",
            "issuanceExpiresAt"
          FROM "AuthLoginAttempt"
          WHERE "id" = ${attemptId}::uuid
          FOR UPDATE
        `;

        const attempt = attempts[0];

        if (
          !attempt ||
          attempt.reservationId != null ||
          attempt.callerIssuer !== callerIssuer ||
          attempt.audience !== 'MARKETPLACE' ||
          attempt.contextBinding !== contextBinding ||
          attempt.state !== 'ADMITTED'
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

        // clock_timestamp advances during a PostgreSQL transaction.
        const clocks = await transaction.$queryRaw<{ now: Date }[]>`
          SELECT clock_timestamp() AS "now"
        `;
        const createdAt = clocks[0]?.now;

        if (
          !createdAt ||
          authenticatedAtMs > createdAt.getTime() ||
          expiresAt.getTime() <= createdAt.getTime() ||
          attempt.issuanceExpiresAt.getTime() <= createdAt.getTime()
        ) {
          throw this.unresolved();
        }

        const session = await transaction.authSession.create({
          data: {
            accountId,
            audience: 'MARKETPLACE',
            loginAttemptId: attemptId,
            authenticatedAt,
            createdAt,
            expiresAt,
          },
          select: {
            id: true,
            expiresAt: true,
          },
        });

        // Recheck completion eligibility after the session write.
        // Failure rolls back that write in the same transaction.
        const completionClocks = await transaction.$queryRaw<{ now: Date }[]>`
          SELECT clock_timestamp() AS "now"
        `;
        const completionTime = completionClocks[0]?.now;

        if (
          !completionTime ||
          attempt.issuanceExpiresAt.getTime() <= completionTime.getTime() ||
          expiresAt.getTime() <= completionTime.getTime()
        ) {
          throw this.unresolved();
        }

        await transaction.authLoginAttempt.update({
          where: { id: attemptId },
          data: { state: 'COMMITTED' },
        });

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

      throw this.unavailable();
    }
  }

  private unresolved(): ConflictException {
    return new ConflictException({
      code: 'AUTH_REFERENCE_UNRESOLVED',
      message: 'The authentication operation could not be resolved.',
    });
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'AUTH_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable.',
    });
  }
}
