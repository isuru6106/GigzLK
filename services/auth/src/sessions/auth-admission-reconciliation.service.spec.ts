import { ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import * as admissionLock from './auth-admission-lock';
import { AuthAdmissionReconciliationService } from './auth-admission-reconciliation.service';

describe('AuthAdmissionReconciliationService', () => {
  const now = new Date('2026-11-24T12:30:00.000Z');
  const createdAt = new Date('2026-11-22T12:30:00.000Z');
  const epoch = '11111111-1111-4111-8111-111111111111';
  const reservationId = '22222222-2222-4222-8222-222222222222';
  const attemptId = '33333333-3333-4333-8333-333333333333';
  const sessionId = '44444444-4444-4444-8444-444444444444';
  const hour = BigInt(Math.floor(now.getTime() / 3_600_000));

  const findReservations = jest.fn();
  const queryRaw = jest.fn();
  const findSession = jest.fn();
  const revokeSession = jest.fn();
  const updateAttempt = jest.fn();
  const updateReservation = jest.fn();

  const transactionClient = {
    $queryRaw: queryRaw,
    authAdmissionReservation: {
      findMany: findReservations,
      update: updateReservation,
    },
    authLoginAttempt: {
      update: updateAttempt,
    },
    authSession: {
      findUnique: findSession,
      updateMany: revokeSession,
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

  const service = new AuthAdmissionReconciliationService(database);

  function reservation() {
    return {
      id: reservationId,
      callerIssuer: 'urn:gigzlk:test:marketplace-bff',
      audience: 'MARKETPLACE',
      contextBinding: 'internal-context-reference',
      createdAt,
      consumedAt: null,
      state: 'RESERVED',
    };
  }

  function attempt(state = 'ADMITTED') {
    return {
      id: attemptId,
      callerIssuer: reservation().callerIssuer,
      audience: reservation().audience,
      contextBinding: reservation().contextBinding,
      state,
      admittedAt: createdAt,
    };
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

    findReservations.mockResolvedValue([reservation()]);
    queryRaw.mockResolvedValue([]);
    findSession.mockResolvedValue(null);
    revokeSession.mockResolvedValue({ count: 1 });
    updateAttempt.mockResolvedValue({});
    updateReservation.mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('selects bounded pending work whose recovery and issuance windows ended', async () => {
    findReservations.mockResolvedValue([]);

    await expect(service.runBatch()).resolves.toEqual({
      resolvedReservations: 0,
    });

    expect(findReservations).toHaveBeenCalledWith({
      where: {
        namespace: { epoch },
        reconciliationPending: true,
        recoveryExpiresAt: { lte: now },
        issuanceExpiresAt: { lte: now },
      },
      orderBy: [{ recoveryExpiresAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: {
        id: true,
        callerIssuer: true,
        audience: true,
        contextBinding: true,
        createdAt: true,
        consumedAt: true,
        state: true,
      },
    });

    expect(updateReservation).not.toHaveBeenCalled();
  });

  it('resolves an abandoned reservation without an admitted attempt', async () => {
    await expect(service.runBatch()).resolves.toEqual({
      resolvedReservations: 1,
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

  it('cancels an admitted attempt before resolving its reservation', async () => {
    findReservations.mockResolvedValue([
      { ...reservation(), state: 'CONSUMED', consumedAt: createdAt },
    ]);
    queryRaw.mockResolvedValue([attempt()]);

    await service.runBatch();

    expect(updateAttempt).toHaveBeenCalledWith({
      where: { id: attemptId },
      data: {
        state: 'CANCELLED',
        cancelledAt: now,
      },
    });

    expect(updateAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      updateReservation.mock.invocationCallOrder[0],
    );
  });

  it('revokes the associated committed session before resolving work', async () => {
    findReservations.mockResolvedValue([
      { ...reservation(), state: 'CONSUMED', consumedAt: createdAt },
    ]);
    queryRaw.mockResolvedValue([attempt('COMMITTED')]);
    findSession.mockResolvedValue({
      id: sessionId,
      audience: 'MARKETPLACE',
    });

    await service.runBatch();

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
  });

  it('preserves existing cancellation timestamps', async () => {
    findReservations.mockResolvedValue([
      { ...reservation(), state: 'CANCELLED', consumedAt: createdAt },
    ]);
    queryRaw.mockResolvedValue([attempt('CANCELLED')]);

    await service.runBatch();

    expect(updateAttempt).not.toHaveBeenCalled();
    expect(updateReservation).toHaveBeenCalledWith({
      where: { id: reservationId },
      data: { reconciliationPending: false },
    });
  });

  it('fails closed for a consumed reservation without its attempt', async () => {
    findReservations.mockResolvedValue([
      { ...reservation(), state: 'CONSUMED', consumedAt: createdAt },
    ]);

    await expect(service.runBatch()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(updateReservation).not.toHaveBeenCalled();
  });

  it('does not resolve work with mismatched attempt ownership', async () => {
    findReservations.mockResolvedValue([
      { ...reservation(), state: 'CONSUMED', consumedAt: createdAt },
    ]);
    queryRaw.mockResolvedValue([
      { ...attempt(), contextBinding: 'another-context' },
    ]);

    await expect(service.runBatch()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(updateAttempt).not.toHaveBeenCalled();
    expect(updateReservation).not.toHaveBeenCalled();
  });

  it('does not resolve a committed attempt whose session is missing', async () => {
    findReservations.mockResolvedValue([
      { ...reservation(), state: 'CONSUMED', consumedAt: createdAt },
    ]);
    queryRaw.mockResolvedValue([attempt('COMMITTED')]);

    await expect(service.runBatch()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(updateReservation).not.toHaveBeenCalled();
  });

  it('does not clear pending work when revocation storage fails', async () => {
    findReservations.mockResolvedValue([
      { ...reservation(), state: 'CONSUMED', consumedAt: createdAt },
    ]);
    queryRaw.mockResolvedValue([attempt('COMMITTED')]);
    findSession.mockResolvedValue({
      id: sessionId,
      audience: 'MARKETPLACE',
    });
    revokeSession.mockRejectedValue(new Error('PRIVATE_STORAGE_FAILURE'));

    await expect(service.runBatch()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(updateAttempt).not.toHaveBeenCalled();
    expect(updateReservation).not.toHaveBeenCalled();
  });

  it('does not claim resolution on lost commit acknowledgement', async () => {
    transaction.mockImplementationOnce(async (callback) => {
      await callback(transactionClient);
      throw new Error('PRIVATE_COMMIT_ACKNOWLEDGEMENT_FAILURE');
    });

    await expect(service.runBatch()).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      },
    });
  });
});
