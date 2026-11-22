import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database.service';
import * as admissionLock from './auth-admission-lock';
import { AuthAdmissionConsumptionService } from './auth-admission-consumption.service';

describe('AuthAdmissionConsumptionService', () => {
  const now = new Date('2026-11-22T12:30:00.000Z');
  const hour = BigInt(Math.floor(now.getTime() / 3_600_000));
  const epoch = '11111111-1111-4111-8111-111111111111';
  const reservationId = '22222222-2222-4222-8222-222222222222';
  const attemptId = '33333333-3333-4333-8333-333333333333';
  const authorization = Buffer.alloc(32, 7).toString('base64url');
  const issuanceExpiresAt = new Date(now.getTime() + 5 * 60_000);
  const recoveryExpiresAt = new Date(now.getTime() + 24 * 60 * 60_000);

  const input = {
    callerIssuer: 'urn:gigzlk:test:marketplace-bff',
    audience: 'MARKETPLACE' as const,
    contextBinding: 'internal-context-reference',
    namespaceId: '44444444-4444-4444-8444-444444444444',
    attemptComponent: '55555555-5555-4555-8555-555555555555',
    authorization,
  };

  const queryRaw = jest.fn();
  const findReservation = jest.fn();
  const updateReservation = jest.fn();
  const createAttempt = jest.fn();

  const transactionClient = {
    $queryRaw: queryRaw,
    authAdmissionReservation: {
      findUnique: findReservation,
      update: updateReservation,
    },
    authLoginAttempt: {
      create: createAttempt,
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

  const service = new AuthAdmissionConsumptionService(database);

  function reservation() {
    return {
      id: reservationId,
      callerIssuer: input.callerIssuer,
      audience: input.audience,
      contextBinding: input.contextBinding,
      operation: '/internal/v1/auth/login',
      namespace: { epoch },
      authorizationHash: createHash('sha256')
        .update(authorization)
        .digest('hex'),
      state: 'RESERVED',
      createdAt: now,
      authorizationExpiresAt: issuanceExpiresAt,
      issuanceExpiresAt,
      recoveryExpiresAt,
      attempt: null,
    };
  }

  function admittedAttempt() {
    return {
      id: attemptId,
      callerIssuer: input.callerIssuer,
      audience: input.audience,
      contextBinding: input.contextBinding,
      state: 'ADMITTED',
      issuanceExpiresAt,
      verificationClaimHash: 'a'.repeat(64),
      verificationClaimedAt: now,
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

    queryRaw.mockResolvedValue([{ now }]);
    findReservation.mockResolvedValue(reservation());
    updateReservation.mockResolvedValue({});
    createAttempt.mockResolvedValue({
      id: attemptId,
      issuanceExpiresAt,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates an admitted attempt and returns its claim only on first consumption', async () => {
    const result = await service.consume(input);

    expect(result.status).toBe('ADMITTED');

    if (result.status !== 'ADMITTED') {
      throw new Error('Expected first consumption.');
    }

    expect(result.verificationClaim).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(result.verificationClaim, 'base64url')).toHaveLength(32);

    expect(createAttempt).toHaveBeenCalledWith({
      data: {
        reservationId,
        callerIssuer: input.callerIssuer,
        audience: input.audience,
        contextBinding: input.contextBinding,
        state: 'ADMITTED',
        admittedAt: now,
        issuanceExpiresAt,
        recoveryExpiresAt,
        verificationClaimHash: createHash('sha256')
          .update(result.verificationClaim)
          .digest('hex'),
        verificationClaimedAt: now,
      },
      select: {
        id: true,
        issuanceExpiresAt: true,
      },
    });

    expect(updateReservation).toHaveBeenCalledWith({
      where: { id: reservationId },
      data: {
        state: 'CONSUMED',
        consumedAt: now,
      },
    });
  });

  it('returns only safe metadata for an exact duplicate', async () => {
    findReservation.mockResolvedValue({
      ...reservation(),
      state: 'CONSUMED',
      attempt: admittedAttempt(),
    });

    await expect(service.consume(input)).resolves.toEqual({
      status: 'EXISTING',
      attemptId,
      issuanceExpiresAt,
    });

    expect(createAttempt).not.toHaveBeenCalled();
    expect(updateReservation).not.toHaveBeenCalled();
  });

  it('requires the original authorization even for a duplicate', async () => {
    findReservation.mockResolvedValue({
      ...reservation(),
      state: 'CONSUMED',
      attempt: admittedAttempt(),
    });

    await expect(
      service.consume({
        ...input,
        authorization: Buffer.alloc(32, 8).toString('base64url'),
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(createAttempt).not.toHaveBeenCalled();
    expect(updateReservation).not.toHaveBeenCalled();
  });

  it.each([
    { callerIssuer: 'urn:gigzlk:test:other-bff' },
    { audience: 'ADMIN' },
    { contextBinding: 'other-context' },
    { namespace: { epoch: '66666666-6666-4666-8666-666666666666' } },
    { operation: '/internal/v1/auth/refresh' },
  ])('rejects mismatched reservation binding: %o', async (change) => {
    findReservation.mockResolvedValue({
      ...reservation(),
      ...change,
    });

    await expect(service.consume(input)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(createAttempt).not.toHaveBeenCalled();
    expect(updateReservation).not.toHaveBeenCalled();
  });

  it.each(['CANCELLED', 'EXPIRED'])(
    'does not consume a %s reservation',
    async (state) => {
      findReservation.mockResolvedValue({ ...reservation(), state });

      await expect(service.consume(input)).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(createAttempt).not.toHaveBeenCalled();
    },
  );

  it('rejects consumption exactly at authorization expiry', async () => {
    queryRaw.mockResolvedValue([{ now: issuanceExpiresAt }]);

    await expect(service.consume(input)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(createAttempt).not.toHaveBeenCalled();
  });

  it('leaves an unknown reservation unresolved', async () => {
    findReservation.mockResolvedValue(null);

    await expect(service.consume(input)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(createAttempt).not.toHaveBeenCalled();
  });

  it('fails closed for consumed metadata without an associated attempt', async () => {
    findReservation.mockResolvedValue({
      ...reservation(),
      state: 'CONSUMED',
    });

    await expect(service.consume(input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('rejects a duplicate whose attempt has been cancelled', async () => {
    findReservation.mockResolvedValue({
      ...reservation(),
      state: 'CONSUMED',
      attempt: {
        ...admittedAttempt(),
        state: 'CANCELLED',
      },
    });

    await expect(service.consume(input)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(createAttempt).not.toHaveBeenCalled();
  });

  it('does not return a claim when commit acknowledgement is lost', async () => {
    transaction.mockImplementationOnce(async (callback) => {
      await callback(transactionClient);
      throw new Error('PRIVATE_COMMIT_ACKNOWLEDGEMENT_FAILURE');
    });

    await expect(service.consume(input)).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      },
    });
  });

  it('rejects malformed authorization before database work', async () => {
    await expect(
      service.consume({ ...input, authorization: 'invalid' }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction).not.toHaveBeenCalled();
  });
});
