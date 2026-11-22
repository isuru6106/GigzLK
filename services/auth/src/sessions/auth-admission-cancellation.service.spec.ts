import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import * as admissionLock from './auth-admission-lock';
import { AuthAdmissionCancellationService } from './auth-admission-cancellation.service';

describe('AuthAdmissionCancellationService', () => {
  const now = new Date('2026-11-22T12:30:00.000Z');
  const hour = BigInt(Math.floor(now.getTime() / 3_600_000));
  const epoch = '11111111-1111-4111-8111-111111111111';
  const reservationId = '22222222-2222-4222-8222-222222222222';
  const attemptId = '33333333-3333-4333-8333-333333333333';
  const sessionId = '44444444-4444-4444-8444-444444444444';
  const recoveryExpiresAt = new Date(now.getTime() + 24 * 60 * 60_000);

  const input = {
    callerIssuer: 'urn:gigzlk:test:marketplace-bff',
    audience: 'MARKETPLACE' as const,
    contextBinding: 'internal-context-reference',
    namespaceId: '55555555-5555-4555-8555-555555555555',
    attemptComponent: '66666666-6666-4666-8666-666666666666',
  };

  const queryRaw = jest.fn();
  const findReservation = jest.fn();
  const updateReservation = jest.fn();
  const findSession = jest.fn();
  const revokeSession = jest.fn();
  const updateAttempt = jest.fn();

  const transactionClient = {
    $queryRaw: queryRaw,
    authAdmissionReservation: {
      findUnique: findReservation,
      update: updateReservation,
    },
    authSession: {
      findUnique: findSession,
      updateMany: revokeSession,
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

  const service = new AuthAdmissionCancellationService(database);

  function reservation() {
    return {
      id: reservationId,
      callerIssuer: input.callerIssuer,
      audience: input.audience,
      contextBinding: input.contextBinding,
      operation: '/internal/v1/auth/login',
      namespace: { epoch },
      state: 'RESERVED',
      createdAt: now,
      recoveryExpiresAt,
      consumedAt: null,
      reconciliationPending: true,
    };
  }

  function attempt(state = 'ADMITTED') {
    return {
      id: attemptId,
      callerIssuer: input.callerIssuer,
      audience: input.audience,
      contextBinding: input.contextBinding,
      state,
    };
  }

  function arrangeAttempt(rows: unknown[]) {
    queryRaw.mockReset();
    queryRaw.mockResolvedValueOnce([{ now }]).mockResolvedValueOnce(rows);
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
    updateReservation.mockResolvedValue({});
    findSession.mockResolvedValue(null);
    revokeSession.mockResolvedValue({ count: 1 });
    updateAttempt.mockResolvedValue({});

    arrangeAttempt([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('cancels a reservation before an admitted attempt exists', async () => {
    await expect(service.cancel(input)).resolves.toEqual({
      status: 'CANCELLED',
    });

    expect(updateReservation).toHaveBeenCalledWith({
      where: { id: reservationId },
      data: {
        state: 'CANCELLED',
        cancelledAt: now,
        reconciliationPending: false,
      },
    });

    expect(updateAttempt).not.toHaveBeenCalled();
    expect(revokeSession).not.toHaveBeenCalled();
  });

  it('fences an admitted attempt while verification may be running', async () => {
    findReservation.mockResolvedValue({
      ...reservation(),
      state: 'CONSUMED',
      consumedAt: now,
    });
    arrangeAttempt([attempt()]);

    await expect(service.cancel(input)).resolves.toEqual({
      status: 'CANCELLED',
    });

    expect(updateAttempt).toHaveBeenCalledWith({
      where: { id: attemptId },
      data: {
        state: 'CANCELLED',
        cancelledAt: now,
      },
    });

    expect(updateReservation).toHaveBeenCalledTimes(1);
  });

  it('revokes only the committed attempt session', async () => {
    findReservation.mockResolvedValue({
      ...reservation(),
      state: 'CONSUMED',
      consumedAt: now,
    });
    arrangeAttempt([attempt('COMMITTED')]);

    findSession.mockResolvedValue({
      id: sessionId,
      audience: 'MARKETPLACE',
    });

    await expect(service.cancel(input)).resolves.toEqual({
      status: 'CANCELLED',
    });

    expect(revokeSession).toHaveBeenCalledWith({
      where: {
        id: sessionId,
        loginAttemptId: attemptId,
        audience: 'MARKETPLACE',
        revokedAt: null,
      },
      data: { revokedAt: now },
    });

    expect(revokeSession.mock.invocationCallOrder[0]).toBeLessThan(
      updateAttempt.mock.invocationCallOrder[0],
    );

    expect(updateAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      updateReservation.mock.invocationCallOrder[0],
    );
  });

  it('preserves cancellation timestamps on a confirmed duplicate', async () => {
    findReservation.mockResolvedValue({
      ...reservation(),
      state: 'CANCELLED',
      consumedAt: now,
      reconciliationPending: false,
    });
    arrangeAttempt([attempt('CANCELLED')]);

    await expect(service.cancel(input)).resolves.toEqual({
      status: 'CANCELLED',
    });

    expect(updateAttempt).not.toHaveBeenCalled();
    expect(updateReservation).not.toHaveBeenCalled();
  });

  it('clears pending reconciliation after confirming an existing cancellation', async () => {
    findReservation.mockResolvedValue({
      ...reservation(),
      state: 'CANCELLED',
      reconciliationPending: true,
    });

    await service.cancel(input);

    expect(updateReservation).toHaveBeenCalledWith({
      where: { id: reservationId },
      data: { reconciliationPending: false },
    });
  });

  it('leaves an unknown reservation unresolved', async () => {
    findReservation.mockResolvedValue(null);

    await expect(service.cancel(input)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(updateReservation).not.toHaveBeenCalled();
  });

  it.each([
    { callerIssuer: 'urn:gigzlk:test:other-bff' },
    { contextBinding: 'other-context' },
    { audience: 'ADMIN' },
    { namespace: { epoch: '77777777-7777-4777-8777-777777777777' } },
  ])('rejects mismatched reservation ownership: %o', async (change) => {
    findReservation.mockResolvedValue({
      ...reservation(),
      ...change,
    });

    await expect(service.cancel(input)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(updateReservation).not.toHaveBeenCalled();
    expect(updateAttempt).not.toHaveBeenCalled();
    expect(revokeSession).not.toHaveBeenCalled();
  });

  it('rejects browser recovery exactly at its fixed deadline', async () => {
    queryRaw.mockReset();
    queryRaw.mockResolvedValueOnce([{ now: recoveryExpiresAt }]);

    await expect(service.cancel(input)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(updateReservation).not.toHaveBeenCalled();
    expect(updateAttempt).not.toHaveBeenCalled();
  });

  it('does not confirm cancellation when a consumed attempt is missing', async () => {
    findReservation.mockResolvedValue({
      ...reservation(),
      state: 'CONSUMED',
      consumedAt: now,
    });

    await expect(service.cancel(input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(updateReservation).not.toHaveBeenCalled();
  });

  it('does not confirm cancellation when a committed session is missing', async () => {
    findReservation.mockResolvedValue({
      ...reservation(),
      state: 'CONSUMED',
      consumedAt: now,
    });
    arrangeAttempt([attempt('COMMITTED')]);

    await expect(service.cancel(input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(updateAttempt).not.toHaveBeenCalled();
    expect(updateReservation).not.toHaveBeenCalled();
  });

  it('returns an operational failure if revocation cannot be persisted', async () => {
    findReservation.mockResolvedValue({
      ...reservation(),
      state: 'CONSUMED',
      consumedAt: now,
    });
    arrangeAttempt([attempt('COMMITTED')]);

    findSession.mockResolvedValue({
      id: sessionId,
      audience: 'MARKETPLACE',
    });
    revokeSession.mockRejectedValue(new Error('PRIVATE_STORAGE_FAILURE'));

    await expect(service.cancel(input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(updateAttempt).not.toHaveBeenCalled();
    expect(updateReservation).not.toHaveBeenCalled();
  });

  it('does not confirm cancellation on lost commit acknowledgement', async () => {
    transaction.mockImplementationOnce(async (callback) => {
      await callback(transactionClient);
      throw new Error('PRIVATE_COMMIT_ACKNOWLEDGEMENT_FAILURE');
    });

    await expect(service.cancel(input)).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      },
    });
  });

  it('rejects malformed references before database work', async () => {
    await expect(
      service.cancel({ ...input, namespaceId: 'invalid' }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction).not.toHaveBeenCalled();
  });
});
