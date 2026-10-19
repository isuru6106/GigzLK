import { afterEach, beforeEach, describe, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database.service';

describe('Payment HTTP endpoints', () => {
  let app: INestApplication<App> | undefined;

  const database = {
    checkReadiness: jest.fn<() => Promise<void>>(),
  };

  beforeEach(async () => {
    database.checkReadiness.mockReset();
    database.checkReadiness.mockResolvedValue(undefined);

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue(database)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  function server() {
    if (!app) {
      throw new Error('Test application was not initialized');
    }

    return app.getHttpServer();
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns the welcome message', async () => {
    await request(server()).get('/').expect(200).expect('Hello World!');
  });

  it('reports readiness when the database responds', async () => {
    await request(server())
      .get('/health/ready')
      .expect(200)
      .expect({ status: 'UP', service: 'payment' });
  });

  it('reports unavailable without exposing database errors', async () => {
    database.checkReadiness.mockRejectedValueOnce(
      new Error('Sensitive database connection details'),
    );

    await request(server())
      .get('/health/ready')
      .expect(503)
      .expect({ status: 'DOWN', service: 'payment' });
  });

  it('remains live when the database is unavailable', async () => {
    database.checkReadiness.mockRejectedValue(
      new Error('Database unavailable'),
    );

    await request(server())
      .get('/health/live')
      .expect(200)
      .expect({ status: 'UP', service: 'payment' });
  });
});
