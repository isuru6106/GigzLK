import { ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import * as admissionLock from './auth-admission-lock';
import { AuthAdmissionNamespaceService } from './auth-admission-namespace.service';

describe('AuthAdmissionNamespaceService', () => {
  const now = new Date('2026-11-22T12:30:00.000Z');
  const hour = BigInt(Math.floor(now.getTime() / 3_600_000));
  const epoch = '11111111-1111-4111-8111-111111111111';
  const namespaceId = '22222222-2222-4222-8222-222222222222';

  const findNamespace = jest.fn();
  const createNamespace = jest.fn();

  const transactionClient = {
    authAdmissionNamespace: {
      findUnique: findNamespace,
      create: createNamespace,
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

  const service = new AuthAdmissionNamespaceService(database);

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

    findNamespace.mockResolvedValue({
      id: namespaceId,
      epoch,
      hour,
      openedAt: now,
      closedAt: null,
    });

    createNamespace.mockResolvedValue({
      id: namespaceId,
      epoch,
      hour,
      openedAt: now,
      closedAt: null,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reuses the current open namespace', async () => {
    await expect(service.current()).resolves.toEqual({
      namespaceId,
      epoch,
    });

    expect(findNamespace).toHaveBeenCalledWith({
      where: {
        epoch_hour: { epoch, hour },
      },
    });

    expect(createNamespace).not.toHaveBeenCalled();
  });

  it('creates a missing current namespace under the control lock', async () => {
    findNamespace.mockResolvedValue(null);

    await expect(service.current()).resolves.toEqual({
      namespaceId,
      epoch,
    });

    expect(createNamespace).toHaveBeenCalledWith({
      data: {
        epoch,
        hour,
        openedAt: now,
      },
    });

    const lock = jest.mocked(admissionLock.lockAdmissionControl);

    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(
      findNamespace.mock.invocationCallOrder[0],
    );
  });

  it('never reopens a closed namespace', async () => {
    findNamespace.mockResolvedValue({
      id: namespaceId,
      epoch,
      hour,
      openedAt: now,
      closedAt: now,
    });

    await expect(service.current()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(createNamespace).not.toHaveBeenCalled();
  });

  it('fails closed when admission control is unavailable', async () => {
    jest
      .mocked(admissionLock.lockAdmissionControl)
      .mockRejectedValue(new Error('PRIVATE_CONTROL_FAILURE'));

    await expect(service.current()).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      },
    });

    expect(findNamespace).not.toHaveBeenCalled();
    expect(createNamespace).not.toHaveBeenCalled();
  });

  it('does not return a namespace on lost commit acknowledgement', async () => {
    transaction.mockImplementationOnce(async (callback) => {
      await callback(transactionClient);
      throw new Error('PRIVATE_COMMIT_ACKNOWLEDGEMENT_FAILURE');
    });

    await expect(service.current()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
