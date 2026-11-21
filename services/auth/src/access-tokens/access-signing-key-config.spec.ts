import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadAccessSigningKey,
  type AccessSigningKeyConfig,
} from './access-signing-key-config';

describe('loadAccessSigningKey', () => {
  const configurationError =
    'Unable to load access-token signing key configuration.';

  function rsaPair() {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });

    return {
      privatePem: pair.privateKey
        .export({ format: 'pem', type: 'pkcs8' })
        .toString(),
      publicPem: pair.publicKey
        .export({ format: 'pem', type: 'spki' })
        .toString(),
    };
  }

  const pair = rsaPair();
  const otherPair = rsaPair();

  let directory: string;
  let config: AccessSigningKeyConfig;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'gigzlk-access-key-'));

    config = {
      kid: 'access-current',
      privateKeyFile: join(directory, 'private.pem'),
      publicKeyFile: join(directory, 'public.pem'),
    };

    writeFileSync(config.privateKeyFile!, pair.privatePem);
    writeFileSync(config.publicKeyFile!, pair.publicPem);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('loads a matching RSA key pair from files', () => {
    const result = loadAccessSigningKey(config);

    expect(result.kid).toBe('access-current');
    expect(
      result.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    ).toBe(pair.privatePem);
    expect(
      result.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    ).toBe(pair.publicPem);
  });

  const fields: (keyof AccessSigningKeyConfig)[] = [
    'kid',
    'privateKeyFile',
    'publicKeyFile',
  ];

  describe.each(fields)('%s configuration', (field) => {
    it.each([undefined, '', ' ', '\t', '\n'])(
      'rejects a missing or blank value: %p',
      (value) => {
        expect(() =>
          loadAccessSigningKey({ ...config, [field]: value }),
        ).toThrow(configurationError);
      },
    );

    it.each(['leading', 'trailing'])('rejects %s whitespace', (position) => {
      const original = config[field]!;
      const value = position === 'leading' ? ` ${original}` : `${original} `;

      expect(() => loadAccessSigningKey({ ...config, [field]: value })).toThrow(
        configurationError,
      );
    });
  });

  it.each(['privateKeyFile', 'publicKeyFile'] as const)(
    'returns a generic error when %s cannot be read',
    (field) => {
      const missingPath = join(directory, 'missing-secret.pem');

      expect(() =>
        loadAccessSigningKey({ ...config, [field]: missingPath }),
      ).toThrow(new Error(configurationError));
    },
  );

  it('returns a generic error for an invalid key identifier', () => {
    expect(() =>
      loadAccessSigningKey({ ...config, kid: '../invalid' }),
    ).toThrow(new Error(configurationError));
  });

  it.each(['privateKeyFile', 'publicKeyFile'] as const)(
    'returns a generic error for malformed data in %s',
    (field) => {
      writeFileSync(config[field]!, 'invalid-key-material');

      expect(() => loadAccessSigningKey(config)).toThrow(
        new Error(configurationError),
      );
    },
  );

  it('returns a generic error for mismatched keys', () => {
    writeFileSync(config.publicKeyFile!, otherPair.publicPem);

    expect(() => loadAccessSigningKey(config)).toThrow(
      new Error(configurationError),
    );
  });
});
