import { ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import * as admissionLock from './auth-admission-lock';
import { AuthAdmissionCleanupService } from './auth-admission-cleanup.service';

describe('AuthAdmissionCleanupService', () => {
  const now = new Date('2026-11-25T12:30:00.000Z');
  const hour = BigInt(Math.floor(now.getTime() / 3_600_000));
  const epoch = '11111111-1111-4111-8111-111111111111';
  const reservationId = '22222222-2222-4222-8222-222222222222';

  const queryRaw = jest.fn();
  const deleteAttempts = jest.fn();
  const deleteReservations = jest.fn();

  const transactionClient = {
    $queryRaw: queryRaw,
    authLoginAttempt: {
      deleteMany: deleteAttempts,
    },
    authAdmissionReservation: {
      deleteMany: deleteReservations,
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

  const service = new AuthAdmissionCleanupService(database);

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

    queryRaw.mockResolvedValue([{ id: reservationId }]);
    deleteAttempts.mockResolvedValue({ count: 1 });
    deleteReservations.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does nothing when no eligible metadata is selected', async () => {
    queryRaw.mockResolvedValue([]);

    await expect(service.runBatch()).resolves.toEqual({
      deletedAttempts: 0,
      deletedReservations: 0,
    });

    expect(deleteAttempts).not.toHaveBeenCalled();
    expect(deleteReservations).not.toHaveBeenCalled();
  });

  it('deletes terminal attempts without sessions before their reservations', async () => {
    await expect(service.runBatch()).resolves.toEqual({
      deletedAttempts: 1,
      deletedReservations: 1,
    });

    expect(deleteAttempts).toHaveBeenCalledWith({
      where: {
        reservationId: { in: [reservationId] },
        state: { in: ['CANCELLED', 'REJECTED', 'EXPIRED'] },
        session: { is: null },
      },
    });

    expect(deleteReservations).toHaveBeenCalledWith({
      where: {
        id: { in: [reservationId] },
        reconciliationPending: false,
        state: { in: ['CANCELLED', 'EXPIRED'] },
        recoveryExpiresAt: { lte: now },
        issuanceExpiresAt: { lte: now },
        attempt: { is: null },
      },
    });

    expect(deleteAttempts.mock.invocationCallOrder[0]).toBeLessThan(
      deleteReservations.mock.invocationCallOrder[0],
    );
  });

  it('reports actual deletion counts', async () => {
    deleteAttempts.mockResolvedValue({ count: 0 });
    deleteReservations.mockResolvedValue({ count: 0 });

    await expect(service.runBatch()).resolves.toEqual({
      deletedAttempts: 0,
      deletedReservations: 0,
    });
  });

  it('acquires the shared control lock before selecting cleanup candidates', async () => {
    await service.runBatch();

    const lock = jest.mocked(admissionLock.lockAdmissionControl);

    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(
      queryRaw.mock.invocationCallOrder[0],
    );
  });

  it('fails closed when admission control is unavailable', async () => {
    jest
      .mocked(admissionLock.lockAdmissionControl)
      .mockRejectedValue(new Error('PRIVATE_CONTROL_FAILURE'));

    await expect(service.runBatch()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(queryRaw).not.toHaveBeenCalled();
    expect(deleteAttempts).not.toHaveBeenCalled();
    expect(deleteReservations).not.toHaveBeenCalled();
  });

  it('does not delete reservations after an attempt deletion failure', async () => {
    deleteAttempts.mockRejectedValue(new Error('PRIVATE_DELETE_FAILURE'));

    await expect(service.runBatch()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(deleteReservations).not.toHaveBeenCalled();
  });

  it('returns an operational error when reservation deletion fails', async () => {
    deleteReservations.mockRejectedValue(
      new Error('PRIVATE_RESERVATION_DELETE_FAILURE'),
    );

    await expect(service.runBatch()).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      },
    });

    // Actual transaction rollback is verified with PostgreSQL.
  });

  it('does not report confirmed deletion on lost commit acknowledgement', async () => {
    transaction.mockImplementationOnce(async (callback) => {
      await callback(transactionClient);
      throw new Error('PRIVATE_COMMIT_ACKNOWLEDGEMENT_FAILURE');
    });

    await expect(service.runBatch()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
