import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { DatabaseService } from '../database.service';
import { Prisma } from '../generated/prisma/client';
import { RegistrationService } from './registration.service';

describe('RegistrationService', () => {
  const create = jest.fn<
    Promise<{ id: string; status: string }>,
    [
      {
        data: {
          email: string;
          emailNormalized: string;
          passwordHash: string;
        };
        select: { id: boolean; status: boolean };
      },
    ]
  >();
  const database = {
    client: { account: { create } },
  } as unknown as DatabaseService;
  const service = new RegistrationService(database);

  const input = {
    email: ' Worker@Example.com ',
    password: '  a-long-test-password  ',
  };

  beforeEach(() => {
    create.mockReset();
  });

  it('stores a verifiable hash and requests only safe response fields', async () => {
    const account = {
      id: 'test-account-id',
      status: 'PENDING_VERIFICATION',
    };
    create.mockResolvedValue(account);

    await expect(service.register(input)).resolves.toEqual(account);

    const call = create.mock.calls[0][0] as {
      data: {
        email: string;
        emailNormalized: string;
        passwordHash: string;
      };
      select: Record<string, boolean>;
    };

    expect(call.data.email).toBe('Worker@Example.com');
    expect(call.data.emailNormalized).toBe('worker@example.com');
    expect(call.data.passwordHash).not.toBe(input.password);
    expect(call.data.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(call.data.passwordHash, input.password)).toBe(
      true,
    );
    expect(
      await argon2.verify(call.data.passwordHash, input.password.trim()),
    ).toBe(false);
    expect(call.data).not.toHaveProperty('password');
    expect(call.data).not.toHaveProperty('status');
    expect(call.select).toEqual({ id: true, status: true });
  });

  it('maps a database uniqueness conflict to HTTP 409', async () => {
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Duplicate email', {
        code: 'P2002',
        clientVersion: '7.10.1',
      }),
    );

    await expect(service.register(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('does not expose database error details', async () => {
    create.mockRejectedValue(new Error('PRIVATE_DATABASE_DETAILS'));

    try {
      await service.register(input);
      throw new Error('Expected registration to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const exception = error as ServiceUnavailableException;
      expect(exception.getStatus()).toBe(503);
      expect(exception.getResponse()).toEqual({
        code: 'REGISTRATION_UNAVAILABLE',
        message: 'Registration is temporarily unavailable.',
      });
    }
  });
});
