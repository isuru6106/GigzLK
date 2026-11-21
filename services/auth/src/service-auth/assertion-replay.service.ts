import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { Prisma } from '../generated/prisma/client';

@Injectable()
export class AssertionReplayService {
  constructor(private readonly database: DatabaseService) {}

  async consume(issuer: string, jti: string, expiresAt: Date): Promise<void> {
    try {
      await this.database.client.serviceAssertionReplay.create({
        data: { issuer, jti, expiresAt },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new UnauthorizedException({
          code: 'SERVICE_AUTH_INVALID',
          message: 'Service authentication is invalid.',
        });
      }

      throw new ServiceUnavailableException({
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      });
    }
  }
}
