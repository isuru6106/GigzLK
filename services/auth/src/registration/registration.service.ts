import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { DatabaseService } from '../database.service';
import { Prisma } from '../generated/prisma/client';
import { RegisterDto } from './register.dto';

@Injectable()
export class RegistrationService {
  constructor(private readonly database: DatabaseService) {}

  async register(input: RegisterDto) {
    const email = input.email.trim();
    const emailNormalized = email.toLowerCase();

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    try {
      return await this.database.client.account.create({
        data: {
          email,
          emailNormalized,
          passwordHash,
        },
        select: {
          id: true,
          status: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'ACCOUNT_ALREADY_EXISTS',
          message: 'An account with this email already exists.',
        });
      }

      throw new ServiceUnavailableException({
        code: 'REGISTRATION_UNAVAILABLE',
        message: 'Registration is temporarily unavailable.',
      });
    }
  }
}
