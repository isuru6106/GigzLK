import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { MarketplaceSessionService } from './marketplace-session.service';

describe('MarketplaceSessionService', () => {
  const accountId = 'b5718a95-f11f-4cfe-91dc-55d595af8dbc';
  const sessionId = 'ddce7093-c348-401a-a59e-1493fcbebdeb';

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

  beforeEach(() => {
    queryRaw.mockReset();
    create.mockReset();
    transaction.mockClear();

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-19T10:00:00.000Z'));

    queryRaw.mockResolvedValue([
      {
        id: accountId,
        status: 'ACTIVE',
        emailVerifiedAt: new Date('2026-11-18T10:00:00.000Z'),
      },
    ]);

    create.mockResolvedValue({
      id: sessionId,
      expiresAt: new Date('2026-11-26T10:00:00.000Z'),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a marketplace session with exactly seven days of lifetime', async () => {
    await expect(service.createForAccount(accountId)).resolves.toEqual({
      sessionId,
      audience: 'marketplace',
      sessionExpiresAt: new Date('2026-11-26T10:00:00.000Z'),
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        accountId,
        audience: 'MARKETPLACE',
        createdAt: new Date('2026-11-19T10:00:00.000Z'),
        expiresAt: new Date('2026-11-26T10:00:00.000Z'),
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

    await expect(service.createForAccount(accountId)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(create).not.toHaveBeenCalled();
  });

  it('does not create a session before the eligibility lookup completes', async () => {
    let completeLookup!: (accounts: unknown[]) => void;

    queryRaw.mockReturnValue(
      new Promise<unknown[]>((resolve) => {
        completeLookup = resolve;
      }),
    );

    const pending = service.createForAccount(accountId);

    expect(create).not.toHaveBeenCalled();

    completeLookup([
      {
        id: accountId,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    ]);

    await pending;

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('hides database lookup failures', async () => {
    queryRaw.mockRejectedValue(new Error('PRIVATE_DATABASE_DETAILS'));

    await expect(service.createForAccount(accountId)).rejects.toMatchObject({
      response: {
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      },
    });

    expect(create).not.toHaveBeenCalled();
  });

  it('maps session-write failures to service unavailable', async () => {
    create.mockRejectedValue(new Error('PRIVATE_INSERT_DETAILS'));

    await expect(service.createForAccount(accountId)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
