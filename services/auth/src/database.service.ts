import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL is required');
    }

    try {
      const url = new URL(connectionString);
      if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
        throw new Error();
      }
    } catch {
      throw new Error('DATABASE_URL must be a PostgreSQL URL');
    }

    const adapter = new PrismaPg({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 2000,
      query_timeout: 2000,
      statement_timeout: 2000,
    });

    this.client = new PrismaClient({ adapter });
  }

  async checkReadiness(): Promise<void> {
    await this.client.$queryRaw`SELECT "id" FROM "Account" LIMIT 0`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
