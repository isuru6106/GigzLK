import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database.service';
import { Prisma } from '../src/generated/prisma/client';

describe('Registration (e2e)', () => {
  let app: INestApplication<App>;
  const create = jest.fn();
  const account = {
    id: '00000000-0000-4000-8000-000000000001',
    status: 'PENDING_VERIFICATION',
  };
  const valid = {
    email: 'worker@example.com',
    password: 'a-long-test-password',
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({
        checkReadiness: jest.fn(),
        client: { account: { create } },
      })
      .compile();

    app = module.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue(account);
  });

  it('creates a pending account without issuing a session', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(valid)
      .expect(201)
      .expect(account);

    expect(response.headers['set-cookie']).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...valid, email: 'invalid' },
    { ...valid, password: 'short' },
    { ...valid, password: 'x'.repeat(129) },
    { ...valid, password: 123 },
    { ...valid, role: 'ADMIN' },
    { ...valid, status: 'ACTIVE' },
    {},
  ])('rejects invalid input before database access %#', async (input) => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(input)
      .expect(400);

    expect(create).not.toHaveBeenCalled();
  });

  it('returns 409 for duplicate email', async () => {
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Duplicate', {
        code: 'P2002',
        clientVersion: '7.10.1',
      }),
    );

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(valid)
      .expect(409)
      .expect({
        code: 'ACCOUNT_ALREADY_EXISTS',
        message: 'An account with this email already exists.',
      });
  });

  it('returns a safe 503 for database failure', async () => {
    create.mockRejectedValue(new Error('PRIVATE_DATABASE_DETAILS'));

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(valid)
      .expect(503)
      .expect({
        code: 'REGISTRATION_UNAVAILABLE',
        message: 'Registration is temporarily unavailable.',
      });
  });

  afterAll(async () => {
    await app.close();
  });
});
