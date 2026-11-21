import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { DatabaseService } from '../database.service';
import { CredentialsService } from './credentials.service';

type Account = {
  id: string;
  passwordHash: string;
  status: 'ACTIVE' | 'PENDING_VERIFICATION' | 'DISABLED';
  emailVerifiedAt: Date | null;
};

describe('CredentialsService', () => {
  const findUnique = jest.fn<
    Promise<Account | null>,
    [
      {
        where: { emailNormalized: string };
        select: {
          id: boolean;
          passwordHash: boolean;
          status: boolean;
          emailVerifiedAt: boolean;
        };
      },
    ]
  >();

  const database = {
    client: { account: { findUnique } },
  } as unknown as DatabaseService;

  const service = new CredentialsService(database);
  const password = '  a-long-test-password  ';
  let active: Account;

  beforeAll(async () => {
    await service.onModuleInit();
    active = {
      id: 'test-account-id',
      passwordHash: await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      }),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    };
  });

  beforeEach(() => {
    findUnique.mockReset();
    findUnique.mockResolvedValue(active);
  });

  async function expectInvalid(candidate: string = password) {
    try {
      await service.validate({
        email: 'worker@example.com',
        password: candidate,
      });
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });
    }
  }

  it('accepts verified active accounts and returns only the account ID', async () => {
    await expect(
      service.validate({
        email: ' Worker@Example.com ',
        password,
      }),
    ).resolves.toEqual({ accountId: active.id });

    expect(findUnique).toHaveBeenCalledWith({
      where: { emailNormalized: 'worker@example.com' },
      select: {
        id: true,
        passwordHash: true,
        status: true,
        emailVerifiedAt: true,
      },
    });
  });

  it('rejects an incorrect password', async () => {
    await expectInvalid('wrong-password');
  });

  it('preserves password whitespace', async () => {
    await expectInvalid(password.trim());
  });

  it('checks the dummy hash for an unknown account', async () => {
    findUnique.mockResolvedValue(null);
    const actualArgon2 = jest.requireActual<typeof import('argon2')>('argon2');
    const verify = jest.spyOn(actualArgon2, 'verify');

    try {
      await expectInvalid();
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify).toHaveBeenCalledWith(
        expect.stringMatching(/^\$argon2id\$/),
        password,
      );
    } finally {
      verify.mockRestore();
    }
  });

  it.each(['PENDING_VERIFICATION', 'DISABLED'] as const)(
    'rejects %s accounts with the same error',
    async (status) => {
      findUnique.mockResolvedValue({ ...active, status });
      await expectInvalid();
    },
  );

  it('rejects active accounts without verified email', async () => {
    findUnique.mockResolvedValue({ ...active, emailVerifiedAt: null });
    await expectInvalid();
  });

  it('hides database failure details', async () => {
    findUnique.mockRejectedValue(new Error('PRIVATE_DATABASE_DETAILS'));

    await expect(
      service.validate({ email: 'worker@example.com', password }),
    ).rejects.toMatchObject({
      response: {
        code: 'CREDENTIAL_VERIFICATION_UNAVAILABLE',
        message: 'Credential verification is temporarily unavailable.',
      },
      status: 503,
    });
  });

  it('handles a malformed stored hash safely', async () => {
    findUnique.mockResolvedValue({
      ...active,
      passwordHash: 'INVALID_STORED_HASH',
    });

    await expect(
      service.validate({ email: 'worker@example.com', password }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('refuses validation before initialization', async () => {
    const uninitialized = new CredentialsService(database);

    await expect(
      uninitialized.validate({ email: 'worker@example.com', password }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(findUnique).not.toHaveBeenCalled();
  });
});
