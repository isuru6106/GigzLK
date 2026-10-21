import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { Prisma } from '../generated/prisma/client';
import { AssertionReplayService } from './assertion-replay.service';

describe('AssertionReplayService', () => {
  const create = jest.fn<
    Promise<unknown>,
    [{ data: { issuer: string; jti: string; expiresAt: Date } }]
  >();

  const database = {
    client: { serviceAssertionReplay: { create } },
  } as unknown as DatabaseService;

  const service = new AssertionReplayService(database);
  const issuer = 'urn:gigzlk:local:bff:marketplace';
  const jti = 'a'.repeat(32);
  const expiresAt = new Date('2030-01-01T00:00:00Z');

  beforeEach(() => {
    create.mockReset();
  });

  it('stores replay metadata without storing credentials', async () => {
    create.mockResolvedValue({});

    await expect(
      service.consume(issuer, jti, expiresAt),
    ).resolves.toBeUndefined();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: { issuer, jti, expiresAt },
    });
  });

  it('rejects duplicate consumption with a safe 401', async () => {
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('PRIVATE_DETAILS', {
        code: 'P2002',
        clientVersion: '7.10.1',
      }),
    );

    const error: unknown = await service
      .consume(issuer, jti, expiresAt)
      .catch((error: unknown) => error);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getStatus()).toBe(401);
    expect((error as UnauthorizedException).getResponse()).toEqual({
      code: 'SERVICE_AUTH_INVALID',
      message: 'Service authentication is invalid.',
    });
  });

  it.each([
    new Error('PRIVATE_CONNECTION_DETAILS'),
    new Prisma.PrismaClientKnownRequestError('PRIVATE_DETAILS', {
      code: 'P2024',
      clientVersion: '7.10.1',
    }),
  ])('maps database failure to a safe 503', async (failure) => {
    create.mockRejectedValue(failure);

    const error: unknown = await service
      .consume(issuer, jti, expiresAt)
      .catch((error: unknown) => error);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      code: 'AUTH_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable.',
    });
  });
});
