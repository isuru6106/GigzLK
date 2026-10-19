import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { hashVerificationToken } from './verification-token';

function invalidToken() {
  return new BadRequestException({
    code: 'INVALID_VERIFICATION_TOKEN',
    message: 'The verification token is invalid or expired.',
  });
}

@Injectable()
export class EmailVerificationService {
  constructor(private readonly database: DatabaseService) {}

  async verify(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) {
      throw invalidToken();
    }

    const tokenHash = hashVerificationToken(token);

    try {
      await this.database.client.$transaction(
        async (tx) => {
          const stored = await tx.emailVerificationToken.findUnique({
            where: { tokenHash },
          });

          if (!stored || stored.consumedAt !== null) {
            throw invalidToken();
          }

          // Lock and update the account before consuming its token.
          // A failed token check rolls this update back.
          const activated = await tx.account.updateMany({
            where: {
              id: stored.accountId,
              emailNormalized: stored.emailNormalized,
              status: 'PENDING_VERIFICATION',
              emailVerifiedAt: null,
            },
            data: {
              status: 'ACTIVE',
              emailVerifiedAt: new Date(),
            },
          });

          if (activated.count !== 1) {
            throw invalidToken();
          }

          const now = new Date();
          const consumed = await tx.emailVerificationToken.updateMany({
            where: {
              id: stored.id,
              consumedAt: null,
              expiresAt: { gt: now },
            },
            data: { consumedAt: now },
          });

          if (consumed.count !== 1) {
            throw invalidToken();
          }
        },
        { maxWait: 2000, timeout: 5000 },
      );

      return { status: 'VERIFIED' as const };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new ServiceUnavailableException({
        code: 'EMAIL_VERIFICATION_UNAVAILABLE',
        message: 'Email verification is temporarily unavailable.',
      });
    }
  }
}
