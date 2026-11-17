import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database.service';
import { AssertionKeysService } from './assertion-keys.service';

describe('assertion key loading at startup', () => {
  const envName = 'AUTH_ASSERTION_KEYS_FILE';
  const issuer = 'urn:gigzlk:local:bff:marketplace';
  const audience = 'urn:gigzlk:local:auth-internal';
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  let originalPath: string | undefined;
  let directory: string;
  let filePath: string;

  function createModule() {
    return Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({})
      .compile();
  }

  beforeEach(() => {
    originalPath = process.env[envName];
    directory = mkdtempSync(join(tmpdir(), 'gigzlk-auth-startup-'));
    filePath = join(directory, 'keys.json');
  });

  afterEach(() => {
    if (originalPath === undefined) {
      delete process.env[envName];
    } else {
      process.env[envName] = originalPath;
    }

    rmSync(directory, { recursive: true, force: true });
  });

  it('loads configured keys when Nest creates the provider', async () => {
    const pem = publicKey.export({ format: 'pem', type: 'spki' }).toString();

    writeFileSync(
      filePath,
      JSON.stringify([
        {
          issuer,
          subject: 'marketplace-bff',
          audience,
          keys: [{ kid: 'current', pem }],
        },
      ]),
      'utf8',
    );
    process.env[envName] = filePath;

    const moduleRef = await createModule();
    try {
      const encode = (value: object) =>
        Buffer.from(JSON.stringify(value)).toString('base64url');
      const iat = Math.floor(Date.now() / 1000);
      const jti = randomBytes(16).toString('hex');
      const header = encode({
        alg: 'RS256',
        typ: 'gigzlk-service-assertion+jwt',
        kid: 'current',
      });
      const payload = encode({
        iss: issuer,
        sub: 'marketplace-bff',
        aud: audience,
        jti,
        iat,
        exp: iat + 60,
      });
      const input = `${header}.${payload}`;
      const signature = sign('sha256', Buffer.from(input), privateKey);

      expect(
        moduleRef
          .get(AssertionKeysService)
          .validate(`${input}.${signature.toString('base64url')}`),
      ).toMatchObject({ issuer, jti });
    } finally {
      await moduleRef.close();
    }
  });

  it('allows initialization without a key file but rejects validation', async () => {
    delete process.env[envName];

    const moduleRef = await createModule();
    try {
      expect(() =>
        moduleRef.get(AssertionKeysService).validate('unused'),
      ).toThrow(ServiceUnavailableException);
    } finally {
      await moduleRef.close();
    }
  });

  it('rejects initialization when the configured key file is missing', async () => {
    process.env[envName] = filePath;

    await expect(createModule()).rejects.toThrow(
      'Unable to load service assertion key configuration.',
    );
  });
});
