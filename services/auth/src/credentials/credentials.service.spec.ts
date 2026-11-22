import { ServiceUnavailableException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { DatabaseService } from '../database.service';
import { CredentialsService } from './credentials.service';

type Account = {
  id: string;
  passwordHash: string;
  credentialVersion: number;
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
          credentialVersion: boolean;
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
      credentialVersion: 7,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    };
  });

  beforeEach(() => {
    findUnique.mockReset();
    findUnique.mockResolvedValue(active);
  });

  async function expectInvalid(candidate: string = password) {
    await expect(
      service.validate({
        email: 'worker@example.com',
        password: candidate,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      },
      status: 401,
    });
  }

  it('returns only account ID, authentication time and credential version', async () => {
    const before = Date.now();

    const result = await service.validate({
      email: ' Worker@Example.com ',
      password,
    });

    const after = Date.now();

    expect(Object.keys(result).sort()).toEqual([
      'accountId',
      'authenticatedAt',
      'credentialVersion',
    ]);
    expect(result.accountId).toBe(active.id);
    expect(result.credentialVersion).toBe(7);
    expect(result.authenticatedAt).toBeInstanceOf(Date);

    expect(result.authenticatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.authenticatedAt.getTime()).toBeLessThanOrEqual(after);

    expect(findUnique).toHaveBeenCalledWith({
      where: { emailNormalized: 'worker@example.com' },
      select: {
        id: true,
        passwordHash: true,
        credentialVersion: true,
        status: true,
        emailVerifiedAt: true,
      },
    });
  });

  it('returns the version associated with the verified password hash', async () => {
    findUnique.mockResolvedValue({
      ...active,
      credentialVersion: 12,
    });

    const result = await service.validate({
      email: 'worker@example.com',
      password,
    });

    expect(result.credentialVersion).toBe(12);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('captures authentication time after password verification completes', async () => {
    const actualArgon2 = jest.requireActual<typeof import('argon2')>('argon2');
    const verify = jest.spyOn(actualArgon2, 'verify');

    let completeVerification!: (matches: boolean) => void;
    let verificationStarted!: () => void;

    const started = new Promise<void>((resolve) => {
      verificationStarted = resolve;
    });

    verify.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          completeVerification = resolve;
          verificationStarted();
        }),
    );

    jest.useFakeTimers();

    const initialTime = new Date('2026-11-21T14:59:00.000Z');
    const completionTime = new Date('2026-11-21T15:00:00.000Z');

    jest.setSystemTime(initialTime);

    try {
      let settled = false;

      const pending = service
        .validate({ email: 'worker@example.com', password })
        .then((result) => {
          settled = true;
          return result;
        });

      await started;

      expect(settled).toBe(false);

      jest.setSystemTime(completionTime);
      completeVerification(true);

      const result = await pending;

      expect(result.authenticatedAt).toEqual(completionTime);
      expect(result.credentialVersion).toBe(7);
      expect(verify).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
      verify.mockRestore();
    }
  });

  it.each([0, -1, 1.5, NaN, Infinity])(
    'rejects an invalid stored credential version: %p',
    async (credentialVersion) => {
      findUnique.mockResolvedValue({
        ...active,
        credentialVersion,
      });

      await expect(
        service.validate({
          email: 'worker@example.com',
          password,
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    },
  );

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
