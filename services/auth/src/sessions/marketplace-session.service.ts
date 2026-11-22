import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database.service';

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

type LockedAccount = {
  id: string;
  status: string;
  emailVerifiedAt: Date | null;
  credentialVersion: number;
};

@Injectable()
export class MarketplaceSessionService {
  constructor(private readonly database: DatabaseService) {}

  // All arguments must come from successful credential validation.
  // Never accept them directly from browser input.
  async createForAccount(
    accountId: string,
    authenticatedAt: Date,
    credentialVersion: number,
  ): Promise<{
    sessionId: string;
    audience: 'marketplace';
    sessionExpiresAt: Date;
  }> {
    try {
      const authenticatedAtMs =
        authenticatedAt instanceof Date ? authenticatedAt.getTime() : NaN;

      if (
        !Number.isSafeInteger(authenticatedAtMs) ||
        authenticatedAtMs < 0 ||
        authenticatedAtMs > Date.now() ||
        !Number.isSafeInteger(credentialVersion) ||
        credentialVersion < 1
      ) {
        throw new Error('Invalid credential validation result.');
      }

      // Copy before awaiting database work to avoid caller mutation.
      const authenticationTime = new Date(authenticatedAtMs);

      return await this.database.client.$transaction(async (transaction) => {
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

        const createdAt = new Date();
        const expiresAt = new Date(authenticatedAtMs + SESSION_LIFETIME_MS);

        if (
          authenticationTime.getTime() > createdAt.getTime() ||
          expiresAt.getTime() <= createdAt.getTime()
        ) {
          throw new Error('Invalid authentication time.');
        }

        const session = await transaction.authSession.create({
          data: {
            accountId: account.id,
            audience: 'MARKETPLACE',
            authenticatedAt: authenticationTime,
            createdAt,
            expiresAt,
          },
          select: {
            id: true,
            expiresAt: true,
          },
        });

        return {
          sessionId: session.id,
          audience: 'marketplace' as const,
          sessionExpiresAt: session.expiresAt,
        };
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new ServiceUnavailableException({
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      });
    }
  }
}
