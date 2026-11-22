import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database.service';

export type AuthRecoveryAuthority = {
  // Must come from authenticated, authorized internal processing.
  callerIssuer: string;
  audience: 'MARKETPLACE';

  // Validated internal binding reference, never a raw browser cookie.
  contextBinding: string;
};

type LockedAttempt = {
  id: string;
  callerIssuer: string;
  audience: string;
  contextBinding: string;
  state: string;
};

@Injectable()
export class AuthSessionRecoveryService {
  constructor(private readonly database: DatabaseService) {}

  async cancelAttempt(
    authority: AuthRecoveryAuthority,
    attemptId: string,
  ): Promise<{ status: 'CANCELLED' }> {
    this.validateInput(authority, attemptId);

    try {
      return await this.database.client.$transaction(async (transaction) => {
        const attempts = await transaction.$queryRaw<LockedAttempt[]>`
          SELECT
            "id",
            "callerIssuer",
            "audience",
            "contextBinding",
            "state"
          FROM "AuthLoginAttempt"
          WHERE "id" = ${attemptId}::uuid
          FOR UPDATE
        `;

        const attempt = attempts[0];

        if (!this.isAuthorized(attempt, authority)) {
          throw this.unresolved();
        }

        const session = await transaction.authSession.findUnique({
          where: { loginAttemptId: attemptId },
          select: {
            id: true,
            audience: true,
          },
        });

        // Inconsistent associations must not produce a success response.
        if (
          (session && session.audience !== authority.audience) ||
          (attempt.state === 'COMMITTED' && !session)
        ) {
          throw new Error('Inconsistent attempt/session association.');
        }

        if (
          ![
            'ADMITTED',
            'COMMITTED',
            'CANCELLED',
            'REJECTED',
            'EXPIRED',
          ].includes(attempt.state)
        ) {
          throw new Error('Unexpected attempt state.');
        }

        if (session) {
          await transaction.authSession.updateMany({
            where: {
              id: session.id,
              loginAttemptId: attemptId,
              audience: authority.audience,
              revokedAt: null,
            },
            data: { revokedAt: new Date() },
          });
        }

        if (attempt.state !== 'CANCELLED') {
          await transaction.authLoginAttempt.update({
            where: { id: attemptId },
            data: {
              state: 'CANCELLED',
              cancelledAt: new Date(),
            },
          });
        }

        return { status: 'CANCELLED' as const };
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }

      throw this.unavailable();
    }
  }

  async revokeSession(
    authority: AuthRecoveryAuthority,
    sessionId: string,
  ): Promise<{ status: 'REVOKED' }> {
    this.validateInput(authority, sessionId);

    try {
      return await this.database.client.$transaction(async (transaction) => {
        const association = await transaction.authSession.findUnique({
          where: { id: sessionId },
          select: { loginAttemptId: true },
        });

        // Legacy sessions have no verified attempt ownership.
        if (!association?.loginAttemptId) {
          throw this.unresolved();
        }

        const attemptId = association.loginAttemptId;

        // Use the same lock order as cancellation and future issuance:
        // attempt first, then its associated session.
        const attempts = await transaction.$queryRaw<LockedAttempt[]>`
          SELECT
            "id",
            "callerIssuer",
            "audience",
            "contextBinding",
            "state"
          FROM "AuthLoginAttempt"
          WHERE "id" = ${attemptId}::uuid
          FOR UPDATE
        `;

        const attempt = attempts[0];

        if (!this.isAuthorized(attempt, authority)) {
          throw this.unresolved();
        }

        const session = await transaction.authSession.findUnique({
          where: { id: sessionId },
          select: {
            loginAttemptId: true,
            audience: true,
          },
        });

        if (
          !session ||
          session.loginAttemptId !== attemptId ||
          session.audience !== authority.audience
        ) {
          throw this.unresolved();
        }

        if (attempt.state !== 'COMMITTED' && attempt.state !== 'CANCELLED') {
          throw new Error('Inconsistent attempt/session state.');
        }

        await transaction.authSession.updateMany({
          where: {
            id: sessionId,
            loginAttemptId: attemptId,
            audience: authority.audience,
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });

        return { status: 'REVOKED' as const };
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }

      throw this.unavailable();
    }
  }

  private isAuthorized(
    attempt: LockedAttempt | undefined,
    authority: AuthRecoveryAuthority,
  ): attempt is LockedAttempt {
    return (
      attempt !== undefined &&
      attempt.callerIssuer === authority.callerIssuer &&
      attempt.audience === authority.audience &&
      attempt.contextBinding === authority.contextBinding
    );
  }

  private validateInput(
    authority: AuthRecoveryAuthority,
    reference: string,
  ): void {
    const validBinding = (value: unknown): value is string =>
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 255 &&
      value.trim() === value;

    if (
      !authority ||
      !validBinding(authority.callerIssuer) ||
      !validBinding(authority.contextBinding) ||
      authority.audience !== 'MARKETPLACE' ||
      typeof reference !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        reference,
      )
    ) {
      throw this.unresolved();
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
