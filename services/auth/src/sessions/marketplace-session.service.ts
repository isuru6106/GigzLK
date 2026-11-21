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
};

@Injectable()
export class MarketplaceSessionService {
  constructor(private readonly database: DatabaseService) {}

  // Internal operation: accountId must come from validated credentials.
  // This method must never accept an accountId directly from a browser.
  async createForAccount(accountId: string): Promise<{
    sessionId: string;
    audience: 'marketplace';
    sessionExpiresAt: Date;
  }> {
    try {
      return await this.database.client.$transaction(async (transaction) => {
        const accounts = await transaction.$queryRaw<LockedAccount[]>`
          SELECT "id", "status", "emailVerifiedAt"
          FROM "Account"
          WHERE "id" = ${accountId}::uuid
          FOR UPDATE
        `;

        const account = accounts[0];

        if (
          !account ||
          account.status !== 'ACTIVE' ||
          account.emailVerifiedAt === null
        ) {
          throw new UnauthorizedException({
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password.',
          });
        }

        const createdAt = new Date();
        const expiresAt = new Date(createdAt.getTime() + SESSION_LIFETIME_MS);

        const session = await transaction.authSession.create({
          data: {
            accountId: account.id,
            audience: 'MARKETPLACE',
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
