import {
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { DatabaseService } from '../database.service';
import { CredentialsDto } from './credentials.dto';

@Injectable()
export class CredentialsService implements OnModuleInit {
  private dummyHash?: string;

  constructor(private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    try {
      this.dummyHash = await argon2.hash(randomBytes(32), {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
    } catch {
      throw new Error('Credential verification initialization failed.');
    }
  }

  async validate(input: CredentialsDto): Promise<{ accountId: string }> {
    const dummyHash = this.dummyHash;

    if (!dummyHash) {
      throw this.unavailable();
    }

    let account;
    let passwordMatches: boolean;

    try {
      account = await this.database.client.account.findUnique({
        where: {
          emailNormalized: input.email.trim().toLowerCase(),
        },
        select: {
          id: true,
          passwordHash: true,
          status: true,
          emailVerifiedAt: true,
        },
      });

      passwordMatches = await argon2.verify(
        account?.passwordHash ?? dummyHash,
        input.password,
      );
    } catch {
      throw this.unavailable();
    }

    if (
      !account ||
      !passwordMatches ||
      account.status !== 'ACTIVE' ||
      account.emailVerifiedAt === null
    ) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });
    }

    return { accountId: account.id };
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'CREDENTIAL_VERIFICATION_UNAVAILABLE',
      message: 'Credential verification is temporarily unavailable.',
    });
  }
}
