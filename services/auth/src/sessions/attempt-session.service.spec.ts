import {
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database.service';
import type { ValidatedCredentials } from '../credentials/credentials.service';
import type { AuthRecoveryAuthority } from './auth-session-recovery.service';
import { AttemptSessionService } from './attempt-session.service';

describe('AttemptSessionService', () => {
  const attemptId = '11111111-1111-4111-8111-111111111111';
  const accountId = '22222222-2222-4222-8222-222222222222';
  const sessionId = '33333333-3333-4333-8333-333333333333';

  const now = new Date('2026-11-22T12:00:00.000Z');
  const issuanceExpiresAt = new Date('2026-11-22T12:05:00.000Z');
  const sessionExpiresAt = new Date('2026-11-29T12:00:00.000Z');

  const authority: AuthRecoveryAuthority = {
    callerIssuer: 'urn:gigzlk:test:marketplace-bff',
    audience: 'MARKETPLACE',
    contextBinding: 'internal-context-reference',
  };

  const credentials: ValidatedCredentials = {
    accountId,
    authenticatedAt: now,
    credentialVersion: 2,
  };

  const queryRaw = jest.fn();
  const createSession = jest.fn();
  const updateAttempt = jest.fn();

  const transactionClient = {
    $queryRaw: queryRaw,
    authSession: { create: createSession },
    authLoginAttempt: { update: updateAttempt },
  };

  const transaction = jest.fn(
    async (
      callback: (client: typeof transactionClient) => Promise<unknown>,
    ): Promise<unknown> => callback(transactionClient),
  );

  const database = {
    client: { $transaction: transaction },
  } as unknown as DatabaseService;

  const service = new AttemptSessionService(database);

  function admittedAttempt() {
    return {
      id: attemptId,
      callerIssuer: authority.callerIssuer,
      audience: 'MARKETPLACE',
      contextBinding: authority.contextBinding,
      state: 'ADMITTED',
      issuanceExpiresAt,
    };
  }

  function eligibleAccount() {
    return {
      id: accountId,
      status: 'ACTIVE',
      emailVerifiedAt: new Date('2026-11-21T12:00:00.000Z'),
      credentialVersion: 2,
    };
  }

  function arrangeQueries(
    attemptRows: unknown[] = [admittedAttempt()],
    accountRows: unknown[] = [eligibleAccount()],
    creationTime: Date = now,
    completionTime: Date = now,
  ) {
    queryRaw.mockReset();
    queryRaw
      .mockResolvedValueOnce(attemptRows)
      .mockResolvedValueOnce(accountRows)
      .mockResolvedValueOnce([{ now: creationTime }])
      .mockResolvedValueOnce([{ now: completionTime }]);
  }

  beforeEach(() => {
    createSession.mockReset();
    updateAttempt.mockReset();
    transaction.mockReset();

    transaction.mockImplementation(async (callback) =>
      callback(transactionClient),
    );

    createSession.mockResolvedValue({
      id: sessionId,
      expiresAt: sessionExpiresAt,
    });
    updateAttempt.mockResolvedValue({});

    arrangeQueries();

    jest.useFakeTimers();
    jest.setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('associates the session and marks the attempt committed', async () => {
    await expect(
      service.createForAttempt(authority, attemptId, credentials),
    ).resolves.toEqual({
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

    expect(updateAttempt).toHaveBeenCalledWith({
      where: { id: attemptId },
      data: { state: 'COMMITTED' },
    });

    expect(createSession.mock.invocationCallOrder[0]).toBeLessThan(
      updateAttempt.mock.invocationCallOrder[0],
    );
  });

  it.each(['CANCELLED', 'COMMITTED', 'REJECTED', 'EXPIRED'])(
    'rejects a %s attempt before account lookup or session creation',
    async (state) => {
      arrangeQueries([{ ...admittedAttempt(), state }]);

      await expect(
        service.createForAttempt(authority, attemptId, credentials),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(queryRaw).toHaveBeenCalledTimes(1);
      expect(createSession).not.toHaveBeenCalled();
      expect(updateAttempt).not.toHaveBeenCalled();
    },
  );

  it('leaves an unknown attempt unresolved', async () => {
    arrangeQueries([]);

    await expect(
      service.createForAttempt(authority, attemptId, credentials),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(createSession).not.toHaveBeenCalled();
  });

  it.each([
    { callerIssuer: 'urn:gigzlk:test:other-bff' },
    { audience: 'ADMIN' },
    { contextBinding: 'other-context' },
  ])('rejects mismatched persisted ownership: %o', async (mismatch) => {
    arrangeQueries([{ ...admittedAttempt(), ...mismatch }]);

    await expect(
      service.createForAttempt(authority, attemptId, credentials),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects a stale credential version under the account lock', async () => {
    arrangeQueries(
      [admittedAttempt()],
      [{ ...eligibleAccount(), credentialVersion: 3 }],
    );

    await expect(
      service.createForAttempt(authority, attemptId, credentials),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(createSession).not.toHaveBeenCalled();
    expect(updateAttempt).not.toHaveBeenCalled();
  });

  it.each([
    ['missing account', []],
    ['disabled account', [{ ...eligibleAccount(), status: 'DISABLED' }]],
    ['unverified account', [{ ...eligibleAccount(), emailVerifiedAt: null }]],
  ])('rejects an ineligible %s', async (_label, accounts) => {
    arrangeQueries([admittedAttempt()], accounts);

    await expect(
      service.createForAttempt(authority, attemptId, credentials),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects creation exactly at the issuance deadline', async () => {
    arrangeQueries([admittedAttempt()], [eligibleAccount()], issuanceExpiresAt);

    await expect(
      service.createForAttempt(authority, attemptId, credentials),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(createSession).not.toHaveBeenCalled();
    expect(updateAttempt).not.toHaveBeenCalled();
  });

  it('rejects completion when issuance expires after the session write', async () => {
    arrangeQueries(
      [admittedAttempt()],
      [eligibleAccount()],
      now,
      issuanceExpiresAt,
    );

    await expect(
      service.createForAttempt(authority, attemptId, credentials),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(updateAttempt).not.toHaveBeenCalled();

    // Database rollback is verified separately in PostgreSQL tests.
  });

  it('preserves the absolute session deadline despite delayed creation', async () => {
    const delayedTime = new Date('2026-11-22T12:04:00.000Z');

    arrangeQueries(
      [admittedAttempt()],
      [eligibleAccount()],
      delayedTime,
      delayedTime,
    );

    await service.createForAttempt(authority, attemptId, credentials);

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

  it('rejects an exhausted absolute session lifetime', async () => {
    arrangeQueries([admittedAttempt()], [eligibleAccount()], sessionExpiresAt);

    await expect(
      service.createForAttempt(authority, attemptId, credentials),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(createSession).not.toHaveBeenCalled();
  });

  it('copies credential values before awaiting database work', async () => {
    const supplied: ValidatedCredentials = {
      ...credentials,
      authenticatedAt: new Date(now.getTime()),
    };

    transaction.mockImplementationOnce(async (callback) => {
      supplied.accountId = '44444444-4444-4444-8444-444444444444';
      supplied.credentialVersion = 99;
      supplied.authenticatedAt.setTime(0);

      return callback(transactionClient);
    });

    await service.createForAttempt(authority, attemptId, supplied);

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
  });

  it('maps session-write failure to an operational error', async () => {
    createSession.mockRejectedValue(new Error('PRIVATE_INSERT_FAILURE'));

    await expect(
      service.createForAttempt(authority, attemptId, credentials),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(updateAttempt).not.toHaveBeenCalled();
  });

  it('maps lost commit acknowledgement to an operational error', async () => {
    transaction.mockImplementationOnce(async (callback) => {
      await callback(transactionClient);
      throw new Error('PRIVATE_COMMIT_ACKNOWLEDGEMENT_FAILURE');
    });

    await expect(
      service.createForAttempt(authority, attemptId, credentials),
    ).rejects.toMatchObject({
      response: {
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      },
      status: 503,
    });
  });

  it('rejects malformed attempt references before database work', async () => {
    await expect(
      service.createForAttempt(authority, 'invalid', credentials),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, NaN, Infinity])(
    'rejects invalid credential version %s before database work',
    async (credentialVersion) => {
      await expect(
        service.createForAttempt(authority, attemptId, {
          ...credentials,
          credentialVersion,
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(transaction).not.toHaveBeenCalled();
    },
  );
});
