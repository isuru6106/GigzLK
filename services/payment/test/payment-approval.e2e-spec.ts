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
import type { Payment, Prisma } from '../src/generated/prisma/client';
import {
  PaymentAssignmentClient,
  PaymentCompletionClient,
  PaymentSessionClient,
} from '../src/payments/payment-access.clients';
import {
  ApprovalConflictError,
  PaymentApprovalRepository,
} from '../src/payments/payment-approval.repository';
import { PaymentRepository } from '../src/payments/payment.repository';
import { toPaymentResponse } from '../src/payments/payment-response';

describe('Payment approval HTTP authorization', () => {
  let app: INestApplication<App> | undefined;

  const accountId = '00000000-0000-4000-8000-000000000003';

  const payment: Payment = {
    id: '00000000-0000-4000-8000-000000000001',
    assignmentId: '00000000-0000-4000-8000-000000000002',
    grossMinor: 1_000_000n,
    currency: 'LKR',
    fundedAt: new Date('2026-11-23T08:00:00.000Z'),
    approvedAt: null,
    releasedAt: null,
    holdActive: false,
    version: 1,
    createdAt: new Date('2026-11-23T07:00:00.000Z'),
    updatedAt: new Date('2026-11-23T08:00:00.000Z'),
  };

  const response = toPaymentResponse({
    ...payment,
    approvedAt: new Date('2026-11-23T09:00:00.000Z'),
    version: 2,
    updatedAt: new Date('2026-11-23T09:00:00.000Z'),
  });

  const sessions = {
    checkSession: jest.fn<(token: string) => Promise<{ accountId: string }>>(),
  };

  const assignments = {
    canApprovePayment:
      jest.fn<(account: string, assignment: string) => Promise<boolean>>(),
  };

  const completion = {
    isCompleted: jest.fn<(assignment: string) => Promise<boolean>>(),
  };

  const repository = {
    findById: jest.fn<(id: string) => Promise<Payment | null>>(),
  };

  const approvals = {
    approve:
      jest.fn<
        (
          paymentId: string,
          callerId: string,
          key: string,
          version: number,
        ) => Promise<Prisma.JsonValue>
      >(),
  };

  beforeEach(async () => {
    sessions.checkSession.mockReset().mockResolvedValue({ accountId });
    assignments.canApprovePayment.mockReset().mockResolvedValue(true);
    completion.isCompleted.mockReset().mockResolvedValue(true);
    repository.findById.mockReset().mockResolvedValue(payment);
    approvals.approve.mockReset().mockResolvedValue(response);

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({})
      .overrideProvider(PaymentSessionClient)
      .useValue(sessions)
      .overrideProvider(PaymentAssignmentClient)
      .useValue(assignments)
      .overrideProvider(PaymentCompletionClient)
      .useValue(completion)
      .overrideProvider(PaymentRepository)
      .useValue(repository)
      .overrideProvider(PaymentApprovalRepository)
      .useValue(approvals)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  function approve(
    options: {
      id?: string;
      token?: string | null;
      key?: string | null;
      body?: Record<string, unknown>;
    } = {},
  ) {
    if (!app) {
      throw new Error('Test application was not initialized');
    }

    const operation = request(app.getHttpServer()).post(
      `/api/v1/payments/${options.id ?? payment.id}/approve`,
    );

    if (options.token !== null) {
      operation.set(
        'Authorization',
        `Bearer ${options.token ?? 'test-access-token'}`,
      );
    }

    if (options.key !== null) {
      operation.set('Idempotency-Key', options.key ?? 'approval-test-key');
    }

    return operation.send(options.body ?? {});
  }

  it('approves only after identity, permission and completion checks', async () => {
    await approve()
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect(response);

    expect(sessions.checkSession).toHaveBeenCalledWith('test-access-token');
    expect(assignments.canApprovePayment).toHaveBeenCalledWith(
      accountId,
      payment.assignmentId,
    );
    expect(completion.isCompleted).toHaveBeenCalledWith(payment.assignmentId);
    expect(approvals.approve).toHaveBeenCalledWith(
      payment.id,
      accountId,
      'approval-test-key',
      payment.version,
    );
  });

  it('rejects missing credentials before accessing dependencies', async () => {
    await approve({ token: null }).expect(401);

    expect(sessions.checkSession).not.toHaveBeenCalled();
    expect(repository.findById).not.toHaveBeenCalled();
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it.each([
    { id: 'invalid' },
    { key: null },
    { key: 'key with spaces' },
    { key: 'a'.repeat(129) },
    { body: { grossMinor: '1' } },
    { body: { publisherId: accountId } },
  ])('rejects invalid approval input: %j', async (options) => {
    await approve(options).expect(400).expect('Cache-Control', 'no-store');

    expect(sessions.checkSession).not.toHaveBeenCalled();
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('rejects an invalid session before looking up the payment', async () => {
    sessions.checkSession.mockRejectedValueOnce(
      new UnauthorizedException({ code: 'SESSION_INVALID' }),
    );

    await approve().expect(401);

    expect(repository.findById).not.toHaveBeenCalled();
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('hides payments from unauthorized callers', async () => {
    assignments.canApprovePayment.mockResolvedValueOnce(false);

    await approve().expect(404);

    expect(completion.isCompleted).not.toHaveBeenCalled();
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('rejects missing payments before checking assignment permissions', async () => {
    repository.findById.mockResolvedValueOnce(null);

    await approve().expect(404);

    expect(assignments.canApprovePayment).not.toHaveBeenCalled();
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('rejects approval when work is incomplete', async () => {
    completion.isCompleted.mockResolvedValueOnce(false);

    await approve().expect(409);

    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it.each([
    ['Auth', 'AUTH_UNAVAILABLE'],
    ['assignment', 'ASSIGNMENT_UNAVAILABLE'],
    ['completion', 'COMPLETION_UNAVAILABLE'],
  ])('denies approval when %s validation is unavailable', async (_, code) => {
    const error = new ServiceUnavailableException({ code });

    if (code === 'AUTH_UNAVAILABLE') {
      sessions.checkSession.mockRejectedValueOnce(error);
    } else if (code === 'ASSIGNMENT_UNAVAILABLE') {
      assignments.canApprovePayment.mockRejectedValueOnce(error);
    } else {
      completion.isCompleted.mockRejectedValueOnce(error);
    }

    await approve().expect(503).expect('Cache-Control', 'no-store');

    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it.each(['PAYMENT_STATE_CONFLICT', 'IDEMPOTENCY_CONFLICT'] as const)(
    'maps %s to a safe conflict response',
    async (code) => {
      approvals.approve.mockRejectedValueOnce(new ApprovalConflictError(code));

      await approve()
        .expect(409)
        .expect((result) => {
          expect((result.body as { code: string }).code).toBe(code);
        });
    },
  );

  it('hides storage errors and includes the response request ID', async () => {
    approvals.approve.mockRejectedValueOnce(
      new Error('Sensitive database connection details'),
    );

    await approve()
      .expect(503)
      .expect('Cache-Control', 'no-store')
      .expect((result) => {
        expect(result.body as unknown).toEqual({
          code: 'PAYMENT_UNAVAILABLE',
          message: 'Payment storage is unavailable',
          requestId: result.headers['x-request-id'],
        });
        expect(result.headers['x-request-id']).toEqual(expect.any(String));
      });
  });

  it('reauthorizes a retry before returning its recorded response', async () => {
    await approve().expect(200).expect(response);

    assignments.canApprovePayment.mockResolvedValueOnce(false);

    await approve().expect(404);

    expect(sessions.checkSession).toHaveBeenCalledTimes(2);
    expect(assignments.canApprovePayment).toHaveBeenCalledTimes(2);
    expect(approvals.approve).toHaveBeenCalledTimes(1);
  });
});
