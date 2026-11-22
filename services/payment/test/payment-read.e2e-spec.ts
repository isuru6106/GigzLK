import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database.service';
import type { Payment } from '../src/generated/prisma/client';
import {
  PaymentAssignmentClient,
  PaymentSessionClient,
} from '../src/payments/payment-access.clients';
import { PaymentRepository } from '../src/payments/payment.repository';
import { toPaymentResponse } from '../src/payments/payment-response';

describe('Payment read authorization', () => {
  let app: INestApplication<App> | undefined;

  const accountId = '00000000-0000-4000-8000-000000000003';

  const payment: Payment = {
    id: '00000000-0000-4000-8000-000000000001',
    assignmentId: '00000000-0000-4000-8000-000000000002',
    grossMinor: 1_000_000n,
    currency: 'LKR',
    fundedAt: null,
    approvedAt: null,
    releasedAt: null,
    holdActive: false,
    version: 0,
    createdAt: new Date('2026-11-22T08:00:00.000Z'),
    updatedAt: new Date('2026-11-22T08:00:00.000Z'),
  };

  const sessions = {
    checkSession: jest.fn<(token: string) => Promise<{ accountId: string }>>(),
  };

  const assignments = {
    canReadPayment:
      jest.fn<(account: string, assignment: string) => Promise<boolean>>(),
  };

  const repository = {
    findById: jest.fn<(id: string) => Promise<Payment | null>>(),
  };

  beforeEach(async () => {
    sessions.checkSession.mockReset().mockResolvedValue({ accountId });
    assignments.canReadPayment.mockReset().mockResolvedValue(true);
    repository.findById.mockReset().mockResolvedValue(payment);

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({})
      .overrideProvider(PaymentSessionClient)
      .useValue(sessions)
      .overrideProvider(PaymentAssignmentClient)
      .useValue(assignments)
      .overrideProvider(PaymentRepository)
      .useValue(repository)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  function getPayment(id = payment.id, authenticated = true) {
    if (!app) {
      throw new Error('Test application was not initialized');
    }

    const operation = request(app.getHttpServer()).get(
      `/api/v1/payments/${id}`,
    );

    return authenticated
      ? operation.set('Authorization', 'Bearer test-access-token')
      : operation;
  }

  it('returns only the mapped payment after authorization', async () => {
    await getPayment()
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect(toPaymentResponse(payment));

    expect(sessions.checkSession).toHaveBeenCalledWith('test-access-token');
    expect(assignments.canReadPayment).toHaveBeenCalledWith(
      accountId,
      payment.assignmentId,
    );
  });

  it('rejects missing credentials before reading storage', async () => {
    await getPayment(payment.id, false)
      .expect(401)
      .expect('Cache-Control', 'no-store');

    expect(sessions.checkSession).not.toHaveBeenCalled();
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('rejects malformed payment IDs before reading storage', async () => {
    await getPayment('invalid-id')
      .expect(400)
      .expect('Cache-Control', 'no-store');

    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('rejects invalid sessions before reading storage', async () => {
    sessions.checkSession.mockRejectedValueOnce(
      new UnauthorizedException({
        code: 'SESSION_INVALID',
        message: 'Invalid session',
      }),
    );

    await getPayment().expect(401).expect('Cache-Control', 'no-store');

    expect(repository.findById).not.toHaveBeenCalled();
    expect(assignments.canReadPayment).not.toHaveBeenCalled();
  });

  it('denies access when Auth is unavailable', async () => {
    sessions.checkSession.mockRejectedValueOnce(
      new ServiceUnavailableException({
        code: 'AUTH_UNAVAILABLE',
        message: 'Session validation is unavailable',
      }),
    );

    await getPayment().expect(503).expect('Cache-Control', 'no-store');

    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('returns the same response for missing and unauthorized payments', async () => {
    repository.findById.mockResolvedValueOnce(null);

    const missing = await getPayment()
      .expect(404)
      .expect('Cache-Control', 'no-store');

    expect(assignments.canReadPayment).not.toHaveBeenCalled();

    assignments.canReadPayment.mockResolvedValueOnce(false);

    const denied = await getPayment()
      .expect(404)
      .expect('Cache-Control', 'no-store');

    expect(denied.body as unknown).toEqual(missing.body as unknown);
  });

  it('denies access when assignment validation is unavailable', async () => {
    assignments.canReadPayment.mockRejectedValueOnce(
      new ServiceUnavailableException({
        code: 'ASSIGNMENT_UNAVAILABLE',
        message: 'Assignment validation is unavailable',
      }),
    );

    await getPayment().expect(503).expect('Cache-Control', 'no-store');
  });

  it('hides database failure details', async () => {
    repository.findById.mockRejectedValueOnce(
      new Error('Sensitive database connection details'),
    );

    await getPayment().expect(503).expect('Cache-Control', 'no-store').expect({
      code: 'PAYMENT_UNAVAILABLE',
      message: 'Payment storage is unavailable',
    });

    expect(assignments.canReadPayment).not.toHaveBeenCalled();
  });
});
