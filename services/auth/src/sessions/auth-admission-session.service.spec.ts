import {
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database.service';
import * as admissionLock from './auth-admission-lock';
import { AuthAdmissionSessionService } from './auth-admission-session.service';

describe('AuthAdmissionSessionService', () => {
  const now = new Date('2026-11-22T12:30:00.000Z');
  const hour = BigInt(Math.floor(now.getTime() / 3_600_000));
  const epoch = '11111111-1111-4111-8111-111111111111';
  const reservationId = '22222222-2222-4222-8222-222222222222';
  const attemptId = '33333333-3333-4333-8333-333333333333';
  const accountId = '44444444-4444-4444-8444-444444444444';
  const sessionId = '55555555-5555-4555-8555-555555555555';
  const verificationClaim = Buffer.alloc(32, 9).toString('base64url');

  const issuanceExpiresAt = new Date(now.getTime() + 5 * 60_000);
  const sessionExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60_000);

  const input = {
    callerIssuer: 'urn:gigzlk:test:marketplace-bff',
    audience: 'MARKETPLACE' as const,
    contextBinding: 'internal-context-reference',
    namespaceId: '66666666-6666-4666-8666-666666666666',
    attemptComponent: '77777777-7777-4777-8777-777777777777',
    attemptId,
    verificationClaim,
  };

  const credentials = {
    accountId,
    authenticatedAt: now,
    credentialVersion: 2,
  };

  const queryRaw = jest.fn();
  const executeRaw = jest.fn();
  const findReservation = jest.fn();
  const createSession = jest.fn();

  const transactionClient = {
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
    authAdmissionReservation: {
      findUnique: findReservation,
    },
    authSession: {
      create: createSession,
    },
  };

  const transaction = jest.fn(
    async (
      callback: (client: typeof transactionClient) => Promise<unknown>,
    ): Promise<unknown> => callback(transactionClient),
  );

  const database = {
    client: { $transaction: transaction },
  } as unknown as DatabaseService;

  const service = new AuthAdmissionSessionService(database);

  function reservation() {
    return {
      id: reservationId,
      callerIssuer: input.callerIssuer,
      audience: input.audience,
      contextBinding: input.contextBinding,
      operation: '/internal/v1/auth/login',
      namespace: { epoch },
      state: 'CONSUMED',
      issuanceExpiresAt,
    };
  }

  function attempt() {
    return {
      id: attemptId,
      reservationId,
      callerIssuer: input.callerIssuer,
      audience: input.audience,
      contextBinding: input.contextBinding,
      state: 'ADMITTED',
      issuanceExpiresAt,
      verificationClaimHash: createHash('sha256')
        .update(verificationClaim)
        .digest('hex'),
      verificationStartedAt: now,
    };
  }

  function account() {
    return {
      id: accountId,
      status: 'ACTIVE',
      emailVerifiedAt: now,
      credentialVersion: 2,
    };
  }

  function arrangeQueries(
    attempts: unknown[] = [attempt()],
    accounts: unknown[] = [account()],
    databaseTime = now,
  ) {
    queryRaw.mockReset();
    queryRaw
      .mockResolvedValueOnce(attempts)
      .mockResolvedValueOnce(accounts)
      .mockResolvedValueOnce([{ now: databaseTime }]);
  }

  beforeEach(() => {
    jest.resetAllMocks();

    jest.spyOn(admissionLock, 'lockAdmissionControl').mockResolvedValue({
      epoch,
      activeHour: hour,
      closedThroughHour: hour - 1n,
      now,
    });

    transaction.mockImplementation(async (callback) =>
      callback(transactionClient),
    );

    findReservation.mockResolvedValue(reservation());
    createSession.mockResolvedValue({
      id: sessionId,
      expiresAt: sessionExpiresAt,
    });
    executeRaw.mockResolvedValue(1);
    arrangeQueries();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a session only for the verified admitted attempt', async () => {
    await expect(service.create(input, credentials)).resolves.toEqual({
      sessionId,
      audience: 'marketplace',
      sessionExpiresAt,
    });

    expect(createSession).toHaveBeenCalledWith({
      data: {
        accountId,
        audience: 'MARKETPLACE',
        loginAttemptId: attemptId,
        authenticatedAt: now,
        createdAt: now,
        expiresAt: sessionExpiresAt,
      },
      select: {
        id: true,
        expiresAt: true,
      },
    });

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(createSession.mock.invocationCallOrder[0]).toBeLessThan(
      executeRaw.mock.invocationCallOrder[0],
    );
  });

  it('rejects a reservation from an old restore epoch', async () => {
    findReservation.mockResolvedValue({
      ...reservation(),
      namespace: {
        epoch: '88888888-8888-4888-8888-888888888888',
      },
    });

    await expect(service.create(input, credentials)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(queryRaw).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects a cancelled reservation', async () => {
    findReservation.mockResolvedValue({
      ...reservation(),
      state: 'CANCELLED',
    });

    await expect(service.create(input, credentials)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(createSession).not.toHaveBeenCalled();
  });

  it.each(['CANCELLED', 'COMMITTED', 'REJECTED', 'EXPIRED'])(
    'rejects a %s attempt',
    async (state) => {
      arrangeQueries([{ ...attempt(), state }]);

      await expect(service.create(input, credentials)).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(createSession).not.toHaveBeenCalled();
    },
  );

  it('rejects an attempt whose verification never started', async () => {
    arrangeQueries([
      {
        ...attempt(),
        verificationStartedAt: null,
      },
    ]);

    await expect(service.create(input, credentials)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects an incorrect verification claim', async () => {
    await expect(
      service.create(
        {
          ...input,
          verificationClaim: Buffer.alloc(32, 10).toString('base64url'),
        },
        credentials,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects authentication recorded before verification started', async () => {
    await expect(
      service.create(input, {
        ...credentials,
        authenticatedAt: new Date(now.getTime() - 1),
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects stale credential versions under the account lock', async () => {
    arrangeQueries([attempt()], [{ ...account(), credentialVersion: 3 }]);

    await expect(service.create(input, credentials)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects disabled accounts', async () => {
    arrangeQueries([attempt()], [{ ...account(), status: 'DISABLED' }]);

    await expect(service.create(input, credentials)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects creation exactly at the issuance deadline', async () => {
    arrangeQueries([attempt()], [account()], issuanceExpiresAt);

    await expect(service.create(input, credentials)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects a failed final issuance transition', async () => {
    executeRaw.mockResolvedValue(0);

    await expect(service.create(input, credentials)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(createSession).toHaveBeenCalledTimes(1);
    // PostgreSQL tests must verify that the insert is rolled back.
  });

  it('preserves the absolute session deadline after delayed creation', async () => {
    const delayedTime = new Date(now.getTime() + 60_000);
    arrangeQueries([attempt()], [account()], delayedTime);

    await service.create(input, credentials);

    expect(createSession).toHaveBeenCalledWith({
      data: {
        accountId,
        audience: 'MARKETPLACE',
        loginAttemptId: attemptId,
        authenticatedAt: now,
        createdAt: delayedTime,
        expiresAt: sessionExpiresAt,
      },
      select: {
        id: true,
        expiresAt: true,
      },
    });
  });

  it('does not return success on lost commit acknowledgement', async () => {
    transaction.mockImplementationOnce(async (callback) => {
      await callback(transactionClient);
      throw new Error('PRIVATE_COMMIT_ACKNOWLEDGEMENT_FAILURE');
    });

    await expect(service.create(input, credentials)).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      },
    });
  });

  it('maps session persistence failure to an operational error', async () => {
    createSession.mockRejectedValue(new Error('PRIVATE_STORAGE_FAILURE'));

    await expect(service.create(input, credentials)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('rejects malformed credentials before database work', async () => {
    await expect(
      service.create(input, { ...credentials, credentialVersion: 0 }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(transaction).not.toHaveBeenCalled();
  });
});
