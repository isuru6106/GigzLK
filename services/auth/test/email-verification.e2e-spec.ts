import {
  BadRequestException,
  INestApplication,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { EmailVerificationController } from '../src/email-verification/email-verification.controller';
import { EmailVerificationService } from '../src/email-verification/email-verification.service';

describe('Email verification (e2e)', () => {
  let app: INestApplication<App>;
  const verify = jest.fn<Promise<{ status: 'VERIFIED' }>, [string]>();
  const token = 'a'.repeat(64);

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [EmailVerificationController],
      providers: [
        {
          provide: EmailVerificationService,
          useValue: { verify },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    verify.mockReset();
    verify.mockResolvedValue({ status: 'VERIFIED' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('verifies a valid request', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(200)
      .expect({ status: 'VERIFIED' });

    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith(token);
  });

  it.each([
    {},
    { token: null },
    { token: 123 },
    { token: '' },
    { token: 'a'.repeat(63) },
    { token: 'a'.repeat(65) },
    { token: 'g'.repeat(64) },
    { token: 'A'.repeat(64) },
    { token: ` ${token}` },
    { token, accountId: 'unexpected' },
  ])('rejects invalid input %# before calling the service', async (body) => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send(body)
      .expect(400);

    expect(verify).not.toHaveBeenCalled();
  });

  it('returns the safe invalid-token response', async () => {
    verify.mockRejectedValueOnce(
      new BadRequestException({
        code: 'INVALID_VERIFICATION_TOKEN',
        message: 'The verification token is invalid or expired.',
      }),
    );

    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(400)
      .expect({
        code: 'INVALID_VERIFICATION_TOKEN',
        message: 'The verification token is invalid or expired.',
      });
  });

  it('returns the safe unavailable response', async () => {
    verify.mockRejectedValueOnce(
      new ServiceUnavailableException({
        code: 'EMAIL_VERIFICATION_UNAVAILABLE',
        message: 'Email verification is temporarily unavailable.',
      }),
    );

    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(503)
      .expect({
        code: 'EMAIL_VERIFICATION_UNAVAILABLE',
        message: 'Email verification is temporarily unavailable.',
      });
  });

  it('does not accept verification through GET', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/auth/verify-email')
      .expect(404);

    expect(verify).not.toHaveBeenCalled();
  });
});
