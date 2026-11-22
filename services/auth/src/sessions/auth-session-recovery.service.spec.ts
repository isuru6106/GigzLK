import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import {
  AuthSessionRecoveryService,
  type AuthRecoveryAuthority,
} from './auth-session-recovery.service';

describe('AuthSessionRecoveryService', () => {
  const attemptId = '11111111-1111-4111-8111-111111111111';
  const sessionId = '22222222-2222-4222-8222-222222222222';

  const authority: AuthRecoveryAuthority = {
    callerIssuer: 'urn:gigzlk:test:marketplace-bff',
    audience: 'MARKETPLACE',
    contextBinding: 'internal-context-reference',
  };

  const queryRaw = jest.fn();
  const findSession = jest.fn();
  const updateSessions = jest.fn();
  const updateAttempt = jest.fn();

  const transactionClient = {
    $queryRaw: queryRaw,
    authSession: {
      findUnique: findSession,
      updateMany: updateSessions,
    },
    authLoginAttempt: {
      update: updateAttempt,
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

  const service = new AuthSessionRecoveryService(database);

  function attempt(state = 'ADMITTED') {
    return {
      id: attemptId,
      callerIssuer: authority.callerIssuer,
      audience: authority.audience,
      contextBinding: authority.contextBinding,
      state,
    };
  }

  beforeEach(() => {
    queryRaw.mockReset();
    findSession.mockReset();
    updateSessions.mockReset();
    updateAttempt.mockReset();

    transaction.mockReset();
    transaction.mockImplementation(async (callback) =>
      callback(transactionClient),
    );

    queryRaw.mockResolvedValue([attempt()]);
    findSession.mockResolvedValue(null);
    updateSessions.mockResolvedValue({ count: 1 });
    updateAttempt.mockResolvedValue({});

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-22T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('cancels an admitted attempt without a session', async () => {
    await expect(service.cancelAttempt(authority, attemptId)).resolves.toEqual({
      status: 'CANCELLED',
    });

    expect(updateAttempt).toHaveBeenCalledWith({
      where: { id: attemptId },
      data: {
        state: 'CANCELLED',
        cancelledAt: new Date(),
      },
    });

    expect(updateSessions).not.toHaveBeenCalled();
  });

  it('revokes the committed attempt session before marking cancellation', async () => {
    queryRaw.mockResolvedValue([attempt('COMMITTED')]);
    findSession.mockResolvedValue({
      id: sessionId,
      audience: 'MARKETPLACE',
    });

    await expect(service.cancelAttempt(authority, attemptId)).resolves.toEqual({
      status: 'CANCELLED',
    });

    expect(updateSessions).toHaveBeenCalledWith({
      where: {
        id: sessionId,
        loginAttemptId: attemptId,
        audience: 'MARKETPLACE',
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    expect(updateSessions.mock.invocationCallOrder[0]).toBeLessThan(
      updateAttempt.mock.invocationCallOrder[0],
    );
  });

  it('does not replace the cancellation timestamp on a repeated cancellation', async () => {
    queryRaw.mockResolvedValue([attempt('CANCELLED')]);

    await expect(service.cancelAttempt(authority, attemptId)).resolves.toEqual({
      status: 'CANCELLED',
    });

    expect(updateAttempt).not.toHaveBeenCalled();
  });

  it.each(['REJECTED', 'EXPIRED'])(
    'durably cancels a %s attempt',
    async (state) => {
      queryRaw.mockResolvedValue([attempt(state)]);

      await expect(
        service.cancelAttempt(authority, attemptId),
      ).resolves.toEqual({ status: 'CANCELLED' });

      expect(updateAttempt).toHaveBeenCalledTimes(1);
    },
  );

  it('leaves an unknown attempt unresolved', async () => {
    queryRaw.mockResolvedValue([]);

    await expect(
      service.cancelAttempt(authority, attemptId),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(findSession).not.toHaveBeenCalled();
    expect(updateAttempt).not.toHaveBeenCalled();
    expect(updateSessions).not.toHaveBeenCalled();
  });

  it.each([
    { callerIssuer: 'urn:gigzlk:test:other-bff' },
    { audience: 'ADMIN' },
    { contextBinding: 'other-context' },
  ])('rejects mismatched persisted ownership: %o', async (mismatch) => {
    queryRaw.mockResolvedValue([{ ...attempt(), ...mismatch }]);

    await expect(
      service.cancelAttempt(authority, attemptId),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(findSession).not.toHaveBeenCalled();
    expect(updateAttempt).not.toHaveBeenCalled();
    expect(updateSessions).not.toHaveBeenCalled();
  });

  it('does not confirm cancellation when a committed session is missing', async () => {
    queryRaw.mockResolvedValue([attempt('COMMITTED')]);

    await expect(
      service.cancelAttempt(authority, attemptId),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(updateAttempt).not.toHaveBeenCalled();
  });

  it('does not cancel a session with an inconsistent audience', async () => {
    queryRaw.mockResolvedValue([attempt('COMMITTED')]);
    findSession.mockResolvedValue({
      id: sessionId,
      audience: 'ADMIN',
    });

    await expect(
      service.cancelAttempt(authority, attemptId),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(updateSessions).not.toHaveBeenCalled();
    expect(updateAttempt).not.toHaveBeenCalled();
  });

  it('revokes only the authorized associated session', async () => {
    queryRaw.mockResolvedValue([attempt('COMMITTED')]);
    findSession
      .mockResolvedValueOnce({ loginAttemptId: attemptId })
      .mockResolvedValueOnce({
        loginAttemptId: attemptId,
        audience: 'MARKETPLACE',
      });

    await expect(service.revokeSession(authority, sessionId)).resolves.toEqual({
      status: 'REVOKED',
    });

    expect(updateSessions).toHaveBeenCalledWith({
      where: {
        id: sessionId,
        loginAttemptId: attemptId,
        audience: 'MARKETPLACE',
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    expect(updateAttempt).not.toHaveBeenCalled();
  });

  it('accepts repeated revocation without overwriting revokedAt', async () => {
    queryRaw.mockResolvedValue([attempt('COMMITTED')]);
    findSession.mockResolvedValue({
      loginAttemptId: attemptId,
      audience: 'MARKETPLACE',
    });
    updateSessions.mockResolvedValue({ count: 0 });

    await expect(service.revokeSession(authority, sessionId)).resolves.toEqual({
      status: 'REVOKED',
    });

    expect(updateSessions).toHaveBeenCalledWith({
      where: {
        id: sessionId,
        loginAttemptId: attemptId,
        audience: 'MARKETPLACE',
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  });

  it.each([
    ['unknown session', null],
    ['legacy session', { loginAttemptId: null }],
  ])('leaves an %s unresolved', async (_label, association) => {
    findSession.mockResolvedValue(association);

    await expect(
      service.revokeSession(authority, sessionId),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(queryRaw).not.toHaveBeenCalled();
    expect(updateSessions).not.toHaveBeenCalled();
  });

  it('rejects session revocation by another caller', async () => {
    findSession.mockResolvedValue({ loginAttemptId: attemptId });
    queryRaw.mockResolvedValue([
      {
        ...attempt('COMMITTED'),
        callerIssuer: 'urn:gigzlk:test:other-bff',
      },
    ]);

    await expect(
      service.revokeSession(authority, sessionId),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(updateSessions).not.toHaveBeenCalled();
  });

  it('rechecks the session association after acquiring the attempt lock', async () => {
    queryRaw.mockResolvedValue([attempt('COMMITTED')]);
    findSession
      .mockResolvedValueOnce({ loginAttemptId: attemptId })
      .mockResolvedValueOnce(null);

    await expect(
      service.revokeSession(authority, sessionId),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(updateSessions).not.toHaveBeenCalled();
  });

  it('does not report success before transaction completion', async () => {
    let confirmCommit!: () => void;
    let callbackCompleted!: () => void;

    const completed = new Promise<void>((resolve) => {
      callbackCompleted = resolve;
    });

    const commit = new Promise<void>((resolve) => {
      confirmCommit = resolve;
    });

    transaction.mockImplementationOnce(async (callback) => {
      const result = await callback(transactionClient);
      callbackCompleted();
      await commit;
      return result;
    });

    let settled = false;

    const pending = service
      .cancelAttempt(authority, attemptId)
      .then((result) => {
        settled = true;
        return result;
      });

    await completed;
    expect(settled).toBe(false);

    confirmCommit();

    await expect(pending).resolves.toEqual({ status: 'CANCELLED' });
  });

  it('maps lost commit acknowledgement to an operational failure', async () => {
    transaction.mockImplementationOnce(async (callback) => {
      await callback(transactionClient);
      throw new Error('PRIVATE_COMMIT_ACKNOWLEDGEMENT_FAILURE');
    });

    await expect(
      service.cancelAttempt(authority, attemptId),
    ).rejects.toMatchObject({
      response: {
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      },
      status: 503,
    });
  });

  it('maps revocation storage failure to an operational failure', async () => {
    queryRaw.mockResolvedValue([attempt('COMMITTED')]);
    findSession.mockResolvedValue({
      loginAttemptId: attemptId,
      audience: 'MARKETPLACE',
    });
    updateSessions.mockRejectedValue(new Error('PRIVATE_STORAGE_FAILURE'));

    await expect(
      service.revokeSession(authority, sessionId),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects a malformed reference before starting a transaction', async () => {
    await expect(
      service.cancelAttempt(authority, 'not-a-uuid'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction).not.toHaveBeenCalled();
  });
});
