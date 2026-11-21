import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { MarketplaceSessionService } from './marketplace-session.service';

describe('MarketplaceSessionService', () => {
  const accountId = 'b5718a95-f11f-4cfe-91dc-55d595af8dbc';
  const sessionId = 'ddce7093-c348-401a-a59e-1493fcbebdeb';
  const authenticatedAt = new Date('2026-11-19T10:00:00.000Z');
  const sessionExpiresAt = new Date('2026-11-26T10:00:00.000Z');

  const queryRaw = jest.fn();
  const create = jest.fn();

  const transactionClient = {
    $queryRaw: queryRaw,
    authSession: { create },
  };

  const transaction = jest.fn(
    async (
      callback: (client: typeof transactionClient) => Promise<unknown>,
    ): Promise<unknown> => callback(transactionClient),
  );

  const database = {
    client: {
      $transaction: transaction,
    },
  } as unknown as DatabaseService;

  const service = new MarketplaceSessionService(database);

  function eligibleAccounts() {
    return [
      {
        id: accountId,
        status: 'ACTIVE',
        emailVerifiedAt: new Date('2026-11-18T10:00:00.000Z'),
      },
    ];
  }

  beforeEach(() => {
    queryRaw.mockReset();
    create.mockReset();
    transaction.mockClear();

    jest.useFakeTimers();
    jest.setSystemTime(authenticatedAt);

    queryRaw.mockResolvedValue(eligibleAccounts());

    create.mockResolvedValue({
      id: sessionId,
      expiresAt: sessionExpiresAt,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('persists authentication time and a seven-day absolute deadline', async () => {
    await expect(
      service.createForAccount(accountId, authenticatedAt),
    ).resolves.toEqual({
      sessionId,
      audience: 'marketplace',
      sessionExpiresAt,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        accountId,
        audience: 'MARKETPLACE',
        authenticatedAt,
        createdAt: authenticatedAt,
        expiresAt: sessionExpiresAt,
      },
      select: {
        id: true,
        expiresAt: true,
      },
    });
  });

  it.each([
    ['missing account', []],
    [
      'pending account',
      [
        {
          id: accountId,
          status: 'PENDING_VERIFICATION',
          emailVerifiedAt: null,
        },
      ],
    ],
    [
      'disabled account',
      [
        {
          id: accountId,
          status: 'DISABLED',
          emailVerifiedAt: new Date(),
        },
      ],
    ],
    [
      'active account without verified email',
      [{ id: accountId, status: 'ACTIVE', emailVerifiedAt: null }],
    ],
  ])('rejects %s without creating a session', async (_label, accounts) => {
    queryRaw.mockResolvedValue(accounts);

    await expect(
      service.createForAccount(accountId, authenticatedAt),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(create).not.toHaveBeenCalled();
  });

  it('does not create a session before the eligibility lookup completes', async () => {
    let completeLookup!: (accounts: unknown[]) => void;

    queryRaw.mockReturnValue(
      new Promise<unknown[]>((resolve) => {
        completeLookup = resolve;
      }),
    );

    const pending = service.createForAccount(accountId, authenticatedAt);

    expect(create).not.toHaveBeenCalled();

    completeLookup(eligibleAccounts());

    await pending;

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not extend the deadline when session creation is delayed', async () => {
    const delayedTime = new Date('2026-11-19T10:05:00.000Z');

    queryRaw.mockImplementationOnce(() => {
      jest.setSystemTime(delayedTime);
      return Promise.resolve(eligibleAccounts());
    });

    await service.createForAccount(accountId, authenticatedAt);

    expect(create).toHaveBeenCalledWith({
      data: {
        accountId,
        audience: 'MARKETPLACE',
        authenticatedAt,
        createdAt: delayedTime,
        expiresAt: sessionExpiresAt,
      },
      select: {
        id: true,
        expiresAt: true,
      },
    });
  });

  it.each([
    ['invalid date', new Date(NaN)],
    ['before the Unix epoch', new Date(-1)],
    ['future date', new Date('2026-11-19T10:00:00.001Z')],
  ])('rejects an authentication time with %s', async (_label, value) => {
    await expect(
      service.createForAccount(accountId, value),
    ).rejects.toMatchObject({
      response: {
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      },
    });

    expect(transaction).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects creation at the absolute session deadline', async () => {
    jest.setSystemTime(sessionExpiresAt);

    await expect(
      service.createForAccount(accountId, authenticatedAt),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(create).not.toHaveBeenCalled();
  });

  it('rejects creation if the deadline passes during the account lookup', async () => {
    queryRaw.mockImplementationOnce(() => {
      jest.setSystemTime(sessionExpiresAt);
      return Promise.resolve(eligibleAccounts());
    });

    await expect(
      service.createForAccount(accountId, authenticatedAt),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(create).not.toHaveBeenCalled();
  });

  it('copies authentication time before awaiting database work', async () => {
    const suppliedTime = new Date(authenticatedAt.getTime());

    queryRaw.mockImplementationOnce(() => {
      suppliedTime.setTime(0);
      return Promise.resolve(eligibleAccounts());
    });

    await service.createForAccount(accountId, suppliedTime);

    expect(create).toHaveBeenCalledWith({
      data: {
        accountId,
        audience: 'MARKETPLACE',
        authenticatedAt,
        createdAt: authenticatedAt,
        expiresAt: sessionExpiresAt,
      },
      select: {
        id: true,
        expiresAt: true,
      },
    });
  });

  it('hides database lookup failures', async () => {
    queryRaw.mockRejectedValue(new Error('PRIVATE_DATABASE_DETAILS'));

    await expect(
      service.createForAccount(accountId, authenticatedAt),
    ).rejects.toMatchObject({
      response: {
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      },
    });

    expect(create).not.toHaveBeenCalled();
  });

  it('maps session-write failures to service unavailable', async () => {
    create.mockRejectedValue(new Error('PRIVATE_INSERT_DETAILS'));

    await expect(
      service.createForAccount(accountId, authenticatedAt),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
