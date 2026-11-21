import { Test } from '@nestjs/testing';
import { constants, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database.service';
import { AccessSigningKeyService } from './access-signing-key.service';
import type { MarketplaceAccessClaimsInput } from './marketplace-access-claims';

describe('AccessSigningKeyService', () => {
  const envNames = [
    'AUTH_ACCESS_SIGNING_KID',
    'AUTH_ACCESS_PRIVATE_KEY_FILE',
    'AUTH_ACCESS_PUBLIC_KEY_FILE',
    'AUTH_ASSERTION_KEYS_FILE',
  ] as const;

  const signingEnvNames = [
    'AUTH_ACCESS_SIGNING_KID',
    'AUTH_ACCESS_PRIVATE_KEY_FILE',
    'AUTH_ACCESS_PUBLIC_KEY_FILE',
  ] as const;

  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherPair = generateKeyPairSync('rsa', { modulusLength: 2048 });

  const configurationError =
    'Unable to load access-token signing key configuration.';

  let originals: Map<string, string | undefined>;
  let directory: string;
  let privatePath: string;
  let publicPath: string;

  function createModule() {
    return Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({})
      .compile();
  }

  function input(): MarketplaceAccessClaimsInput {
    const now = Date.now();

    return {
      issuer: 'urn:gigzlk:local:auth',
      accountId: 'b5718a95-f11f-4cfe-91dc-55d595af8dbc',
      sessionId: 'ddce7093-c348-401a-a59e-1493fcbebdeb',
      sessionExpiresAt: new Date(now + 3_600_000),
      authenticatedAt: new Date(now - 60_000),
    };
  }

  beforeEach(() => {
    originals = new Map(envNames.map((name) => [name, process.env[name]]));

    for (const name of envNames) {
      delete process.env[name];
    }

    directory = mkdtempSync(join(tmpdir(), 'gigzlk-access-provider-'));
    privatePath = join(directory, 'private.pem');
    publicPath = join(directory, 'public.pem');

    writeFileSync(
      privatePath,
      pair.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    );
    writeFileSync(
      publicPath,
      pair.publicKey.export({ format: 'pem', type: 'spki' }),
    );

    process.env.AUTH_ACCESS_SIGNING_KID = 'access-current';
    process.env.AUTH_ACCESS_PRIVATE_KEY_FILE = privatePath;
    process.env.AUTH_ACCESS_PUBLIC_KEY_FILE = publicPath;
  });

  afterEach(() => {
    for (const [name, value] of originals) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }

    rmSync(directory, { recursive: true, force: true });
  });

  it('loads the provider through AppModule and signs with the configured key', async () => {
    const moduleRef = await createModule();

    try {
      const result = moduleRef.get(AccessSigningKeyService).sign(input());
      const parts = result.accessToken.split('.');

      expect(parts).toHaveLength(3);

      const header: unknown = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf8'),
      );

      expect(header).toEqual({
        alg: 'RS256',
        typ: 'at+jwt',
        kid: 'access-current',
      });

      expect(
        verify(
          'sha256',
          Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'),
          {
            key: pair.publicKey,
            padding: constants.RSA_PKCS1_PADDING,
          },
          Buffer.from(parts[2], 'base64url'),
        ),
      ).toBe(true);

      expect(result.accessExpiresAt.getTime()).toBeGreaterThan(Date.now());
    } finally {
      await moduleRef.close();
    }
  });

  it('initializes without signing configuration but refuses signing', async () => {
    for (const name of signingEnvNames) {
      delete process.env[name];
    }

    const moduleRef = await createModule();

    try {
      expect(() =>
        moduleRef.get(AccessSigningKeyService).sign(input()),
      ).toThrow('Access-token signing is unavailable.');
    } finally {
      await moduleRef.close();
    }
  });

  it.each(signingEnvNames)(
    'rejects startup when %s is missing from partial configuration',
    async (name) => {
      delete process.env[name];

      await expect(createModule()).rejects.toThrow(configurationError);
    },
  );

  it.each(signingEnvNames)('rejects startup when %s is blank', async (name) => {
    process.env[name] = '';

    await expect(createModule()).rejects.toThrow(configurationError);
  });

  it.each([
    'AUTH_ACCESS_PRIVATE_KEY_FILE',
    'AUTH_ACCESS_PUBLIC_KEY_FILE',
  ] as const)('rejects startup when %s cannot be read', async (name) => {
    process.env[name] = join(directory, 'missing.pem');

    await expect(createModule()).rejects.toThrow(configurationError);
  });

  it('rejects startup when configured keys do not match', async () => {
    writeFileSync(
      publicPath,
      otherPair.publicKey.export({ format: 'pem', type: 'spki' }),
    );

    await expect(createModule()).rejects.toThrow(configurationError);
  });

  it('keeps using the startup key after environment and file changes', async () => {
    const moduleRef = await createModule();

    try {
      process.env.AUTH_ACCESS_SIGNING_KID = 'changed-key';
      rmSync(privatePath);
      rmSync(publicPath);

      const result = moduleRef.get(AccessSigningKeyService).sign(input());
      const [header, payload, signature] = result.accessToken.split('.');

      expect(
        verify(
          'sha256',
          Buffer.from(`${header}.${payload}`, 'ascii'),
          {
            key: pair.publicKey,
            padding: constants.RSA_PKCS1_PADDING,
          },
          Buffer.from(signature, 'base64url'),
        ),
      ).toBe(true);

      const decodedHeader: unknown = JSON.parse(
        Buffer.from(header, 'base64url').toString('utf8'),
      );

      expect(decodedHeader).toMatchObject({ kid: 'access-current' });
    } finally {
      await moduleRef.close();
    }
  });

  it('refuses signing for an expired session', async () => {
    const moduleRef = await createModule();

    try {
      const source = input();
      source.sessionExpiresAt = new Date(Date.now() - 60_000);

      expect(() => moduleRef.get(AccessSigningKeyService).sign(source)).toThrow(
        'Unable to sign marketplace access token.',
      );
    } finally {
      await moduleRef.close();
    }
  });
});
