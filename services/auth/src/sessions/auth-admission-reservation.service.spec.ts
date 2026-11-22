import {
  ConflictException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database.service';
import * as admissionLock from './auth-admission-lock';
import { AuthAdmissionReservationService } from './auth-admission-reservation.service';

describe('AuthAdmissionReservationService', () => {
  const now = new Date('2026-11-22T12:30:00.000Z');
  const hour = BigInt(Math.floor(now.getTime() / 3_600_000));
  const epoch = '11111111-1111-4111-8111-111111111111';

  const input = {
    callerIssuer: 'urn:gigzlk:test:marketplace-bff',
    audience: 'MARKETPLACE' as const,
    contextBinding: 'internal-context-reference',
    namespaceId: '22222222-2222-4222-8222-222222222222',
    attemptComponent: '33333333-3333-4333-8333-333333333333',
  };

  const findNamespace = jest.fn();
  const findReservation = jest.fn();
  const countReservations = jest.fn();
  const createReservation = jest.fn();
  const findQuota = jest.fn();
  const saveQuota = jest.fn();

  const transactionClient = {
    authAdmissionNamespace: {
      findUnique: findNamespace,
    },
    authAdmissionReservation: {
      findUnique: findReservation,
      count: countReservations,
      create: createReservation,
    },
    authAdmissionCallerQuota: {
      findUnique: findQuota,
      upsert: saveQuota,
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

  const service = new AuthAdmissionReservationService(database);

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
      id: input.namespaceId,
      epoch,
      hour,
      closedAt: null,
    });

    findReservation.mockResolvedValue(null);
    countReservations.mockResolvedValue(0);
    createReservation.mockResolvedValue({});
    findQuota.mockResolvedValue(null);
    saveQuota.mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns a 256-bit authorization and persists only its hash', async () => {
    const result = await service.reserve(input);

    expect(result.authorization).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(result.authorization, 'base64url')).toHaveLength(32);

    const issuanceExpiresAt = new Date(now.getTime() + 5 * 60_000);
    const recoveryExpiresAt = new Date(now.getTime() + 24 * 60 * 60_000);

    expect(result).toEqual({
      namespaceId: input.namespaceId,
      attemptComponent: input.attemptComponent,
      authorization: result.authorization,
      authorizationExpiresAt: issuanceExpiresAt,
      issuanceExpiresAt,
      recoveryExpiresAt,
    });

    expect(createReservation).toHaveBeenCalledWith({
      data: {
        ...input,
        operation: '/internal/v1/auth/login',
        authorizationHash: createHash('sha256')
          .update(result.authorization)
          .digest('hex'),
        state: 'RESERVED',
        createdAt: now,
        authorizationExpiresAt: issuanceExpiresAt,
        issuanceExpiresAt,
        recoveryExpiresAt,
        reconciliationPending: true,
      },
    });

    expect(saveQuota).toHaveBeenCalledWith({
      where: { callerIssuer: input.callerIssuer },
      create: {
        callerIssuer: input.callerIssuer,
        tokens: 4,
        refilledAt: now,
      },
      update: {
        tokens: 4,
        refilledAt: now,
      },
    });
  });

  it('does not replace authorization for an existing attempt identity', async () => {
    findReservation.mockResolvedValue({ id: 'existing-reservation' });

    await expect(service.reserve(input)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(saveQuota).not.toHaveBeenCalled();
    expect(createReservation).not.toHaveBeenCalled();
  });

  it.each([
    { epoch: '44444444-4444-4444-8444-444444444444' },
    { closedAt: now },
    { hour: hour - 1n },
  ])('rejects an unavailable namespace: %o', async (change) => {
    findNamespace.mockResolvedValue({
      id: input.namespaceId,
      epoch,
      hour,
      closedAt: null,
      ...change,
    });

    await expect(service.reserve(input)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(createReservation).not.toHaveBeenCalled();
  });

  it('rejects another pending reservation in the context', async () => {
    countReservations.mockResolvedValueOnce(1);

    await expect(service.reserve(input)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(createReservation).not.toHaveBeenCalled();
  });

  it.each([
    ['context rate', [0, 3]],
    ['outstanding caller reservations', [0, 0, 100]],
  ])('enforces the %s limit', async (_label, counts) => {
    for (const count of counts) {
      countReservations.mockResolvedValueOnce(count);
    }

    await expect(service.reserve(input)).rejects.toMatchObject({
      status: 429,
      response: {
        code: 'RATE_LIMITED',
        message: 'Too many authentication requests.',
      },
    });

    expect(createReservation).not.toHaveBeenCalled();
  });

  it.each([
    ['caller capacity', [0, 0, 0, 50_000, 50_000]],
    ['global capacity', [0, 0, 0, 0, 100_000]],
  ])('rejects new reservations at %s', async (_label, counts) => {
    for (const count of counts) {
      countReservations.mockResolvedValueOnce(count);
    }

    await expect(service.reserve(input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(saveQuota).not.toHaveBeenCalled();
    expect(createReservation).not.toHaveBeenCalled();
  });

  it('rejects an exhausted caller token bucket', async () => {
    findQuota.mockResolvedValue({
      tokens: 0,
      refilledAt: now,
    });

    await expect(service.reserve(input)).rejects.toBeInstanceOf(HttpException);

    await expect(service.reserve(input)).rejects.toMatchObject({
      status: 429,
    });

    expect(createReservation).not.toHaveBeenCalled();
  });

  it('refills one token after six seconds', async () => {
    findQuota.mockResolvedValue({
      tokens: 0,
      refilledAt: new Date(now.getTime() - 6000),
    });

    await service.reserve(input);

    expect(saveQuota).toHaveBeenCalledWith({
      where: { callerIssuer: input.callerIssuer },
      create: {
        callerIssuer: input.callerIssuer,
        tokens: 0,
        refilledAt: now,
      },
      update: {
        tokens: 0,
        refilledAt: now,
      },
    });
  });

  it('fails closed when the quota timestamp is ahead of database time', async () => {
    findQuota.mockResolvedValue({
      tokens: 4,
      refilledAt: new Date(now.getTime() + 1),
    });

    await expect(service.reserve(input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(createReservation).not.toHaveBeenCalled();
  });

  it('returns an operational failure on lost commit acknowledgement', async () => {
    transaction.mockImplementationOnce(async (callback) => {
      await callback(transactionClient);
      throw new Error('PRIVATE_COMMIT_ACKNOWLEDGEMENT_FAILURE');
    });

    await expect(service.reserve(input)).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      },
    });
  });

  it('rejects malformed input before database work', async () => {
    await expect(
      service.reserve({ ...input, namespaceId: 'invalid' }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction).not.toHaveBeenCalled();
  });
});
