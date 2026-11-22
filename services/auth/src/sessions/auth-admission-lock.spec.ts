import { ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { lockAdmissionControl } from './auth-admission-lock';

describe('lockAdmissionControl', () => {
  const epoch = '11111111-1111-4111-8111-111111111111';
  const now = new Date('2026-11-22T12:30:00.000Z');
  const hour = BigInt(Math.floor(now.getTime() / 3_600_000));

  const queryRaw = jest.fn();
  const closeNamespaces = jest.fn();
  const updateControl = jest.fn();

  const transaction = {
    $queryRaw: queryRaw,
    authAdmissionNamespace: {
      updateMany: closeNamespaces,
    },
    authAdmissionControl: {
      update: updateControl,
    },
  } as unknown as Prisma.TransactionClient;

  function control() {
    return {
      id: 'admission',
      epoch,
      enabled: true,
      activeHour: hour,
      closedThroughHour: hour - 1n,
    };
  }

  beforeEach(() => {
    queryRaw.mockReset();
    closeNamespaces.mockReset();
    updateControl.mockReset();

    closeNamespaces.mockResolvedValue({ count: 1 });
    updateControl.mockResolvedValue({});
  });

  function arrange(rows: unknown[] = [control()], databaseTime: Date = now) {
    queryRaw
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([{ now: databaseTime }]);
  }

  it('returns the current epoch and database time without advancing', async () => {
    arrange();

    await expect(lockAdmissionControl(transaction)).resolves.toEqual({
      epoch,
      activeHour: hour,
      closedThroughHour: hour - 1n,
      now,
    });

    expect(closeNamespaces).not.toHaveBeenCalled();
    expect(updateControl).not.toHaveBeenCalled();
  });

  it('fails closed when the control row is missing', async () => {
    arrange([]);

    await expect(lockAdmissionControl(transaction)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(updateControl).not.toHaveBeenCalled();
  });

  it('fails closed when admission is disabled', async () => {
    arrange([{ ...control(), enabled: false }]);

    await expect(lockAdmissionControl(transaction)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(updateControl).not.toHaveBeenCalled();
  });

  it('closes older namespaces and advances across skipped hours', async () => {
    const laterTime = new Date(now.getTime() + 3 * 3_600_000);
    arrange([control()], laterTime);

    await expect(lockAdmissionControl(transaction)).resolves.toEqual({
      epoch,
      activeHour: hour + 3n,
      closedThroughHour: hour + 2n,
      now: laterTime,
    });

    expect(closeNamespaces).toHaveBeenCalledWith({
      where: {
        epoch,
        hour: { lt: hour + 3n },
        closedAt: null,
      },
      data: { closedAt: laterTime },
    });

    expect(updateControl).toHaveBeenCalledWith({
      where: { id: 'admission' },
      data: {
        activeHour: hour + 3n,
        closedThroughHour: hour + 2n,
      },
    });

    expect(closeNamespaces.mock.invocationCallOrder[0]).toBeLessThan(
      updateControl.mock.invocationCallOrder[0],
    );
  });

  it('rejects clock rollback without lowering persisted boundaries', async () => {
    arrange([control()], new Date(now.getTime() - 3_600_000));

    await expect(lockAdmissionControl(transaction)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(closeNamespaces).not.toHaveBeenCalled();
    expect(updateControl).not.toHaveBeenCalled();
  });

  it.each([
    { activeHour: -1n },
    { closedThroughHour: -2n },
    { closedThroughHour: hour },
    { closedThroughHour: hour + 1n },
  ])('rejects inconsistent persisted boundaries: %o', async (invalid) => {
    arrange([{ ...control(), ...invalid }]);

    await expect(lockAdmissionControl(transaction)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(updateControl).not.toHaveBeenCalled();
  });

  it('rejects an invalid database timestamp', async () => {
    arrange([control()], new Date(NaN));

    await expect(lockAdmissionControl(transaction)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(updateControl).not.toHaveBeenCalled();
  });

  it('propagates a failed namespace update to abort the transaction', async () => {
    arrange([control()], new Date(now.getTime() + 3_600_000));

    const failure = new Error('TEST_NAMESPACE_WRITE_FAILURE');
    closeNamespaces.mockRejectedValue(failure);

    await expect(lockAdmissionControl(transaction)).rejects.toBe(failure);
    expect(updateControl).not.toHaveBeenCalled();
  });
});
