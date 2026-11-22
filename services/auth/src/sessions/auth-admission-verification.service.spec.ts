import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database.service';
import * as admissionLock from './auth-admission-lock';
import { AuthAdmissionVerificationService } from './auth-admission-verification.service';

describe('AuthAdmissionVerificationService', () => {
  const now = new Date('2026-11-22T12:30:00.000Z');
  const hour = BigInt(Math.floor(now.getTime() / 3_600_000));
  const epoch = '11111111-1111-4111-8111-111111111111';
  const reservationId = '22222222-2222-4222-8222-222222222222';
  const attemptId = '33333333-3333-4333-8333-333333333333';
  const verificationClaim = Buffer.alloc(32, 9).toString('base64url');

  const claimHash = createHash('sha256')
    .update(verificationClaim)
    .digest('hex');

  const issuanceExpiresAt = new Date(now.getTime() + 5 * 60_000);

  const input = {
    callerIssuer: 'urn:gigzlk:test:marketplace-bff',
    audience: 'MARKETPLACE' as const,
    contextBinding: 'internal-context-reference',
    namespaceId: '44444444-4444-4444-8444-444444444444',
    attemptComponent: '55555555-5555-4555-8555-555555555555',
    attemptId,
    verificationClaim,
  };

  const queryRaw = jest.fn();
  const findReservation = jest.fn();
  const startAttempt = jest.fn();

  const transactionClient = {
    $queryRaw: queryRaw,
    authAdmissionReservation: {
      findUnique: findReservation,
    },
    authLoginAttempt: {
      updateMany: startAttempt,
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

  const service = new AuthAdmissionVerificationService(database);

  function reservation() {
    return {
      id: reservationId,
      callerIssuer: input.callerIssuer,
      audience: input.audience,
      contextBinding: input.contextBinding,
      operation: '/internal/v1/auth/login',
      namespace: { epoch },
      state: 'CONSUMED',
      createdAt: now,
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
      verificationClaimHash: claimHash,
      verificationClaimedAt: now,
      verificationStartedAt: null,
    };
  }

  function arrangeAttempt(rows: unknown[] = [attempt()], databaseTime = now) {
    queryRaw.mockReset();
    queryRaw
      .mockResolvedValueOnce(rows)
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
    startAttempt.mockResolvedValue({ count: 1 });
    arrangeAttempt();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('durably marks verification started for the matching claim', async () => {
    await expect(service.start(input)).resolves.toBeUndefined();

    expect(startAttempt).toHaveBeenCalledWith({
      where: {
        id: attemptId,
        reservationId,
        state: 'ADMITTED',
        verificationClaimHash: claimHash,
        verificationStartedAt: null,
      },
      data: { verificationStartedAt: now },
    });
  });

  it('rejects a repeated start', async () => {
    arrangeAttempt([
      {
        ...attempt(),
        verificationStartedAt: now,
      },
    ]);

    await expect(service.start(input)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(startAttempt).not.toHaveBeenCalled();
  });

  it.each(['CANCELLED', 'COMMITTED', 'REJECTED', 'EXPIRED'])(
    'rejects a %s attempt',
    async (state) => {
      arrangeAttempt([{ ...attempt(), state }]);

      await expect(service.start(input)).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(startAttempt).not.toHaveBeenCalled();
    },
  );

  it('rejects an incorrect verification claim', async () => {
    await expect(
      service.start({
        ...input,
        verificationClaim: Buffer.alloc(32, 10).toString('base64url'),
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(startAttempt).not.toHaveBeenCalled();
  });

  it('rejects an old restore epoch', async () => {
    findReservation.mockResolvedValue({
      ...reservation(),
      namespace: {
        epoch: '66666666-6666-4666-8666-666666666666',
      },
    });

    await expect(service.start(input)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(queryRaw).not.toHaveBeenCalled();
    expect(startAttempt).not.toHaveBeenCalled();
  });

  it('rejects a cancelled reservation', async () => {
    findReservation.mockResolvedValue({
      ...reservation(),
      state: 'CANCELLED',
    });

    await expect(service.start(input)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(startAttempt).not.toHaveBeenCalled();
  });

  it('rejects an attempt belonging to another reservation', async () => {
    arrangeAttempt([
      {
        ...attempt(),
        reservationId: '77777777-7777-4777-8777-777777777777',
      },
    ]);

    await expect(service.start(input)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(startAttempt).not.toHaveBeenCalled();
  });

  it('rejects verification exactly at the issuance deadline', async () => {
    arrangeAttempt([attempt()], issuanceExpiresAt);

    await expect(service.start(input)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(startAttempt).not.toHaveBeenCalled();
  });

  it('fails closed when the stored claim is malformed', async () => {
    arrangeAttempt([
      {
        ...attempt(),
        verificationClaimHash: 'invalid',
      },
    ]);

    await expect(service.start(input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(startAttempt).not.toHaveBeenCalled();
  });

  it('rejects a conditional update that did not claim exactly one attempt', async () => {
    startAttempt.mockResolvedValue({ count: 0 });

    await expect(service.start(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('does not authorize verification on lost commit acknowledgement', async () => {
    transaction.mockImplementationOnce(async (callback) => {
      await callback(transactionClient);
      throw new Error('PRIVATE_COMMIT_ACKNOWLEDGEMENT_FAILURE');
    });

    await expect(service.start(input)).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      },
    });
  });

  it('rejects malformed input before database work', async () => {
    await expect(
      service.start({ ...input, verificationClaim: 'invalid' }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction).not.toHaveBeenCalled();
  });
});
