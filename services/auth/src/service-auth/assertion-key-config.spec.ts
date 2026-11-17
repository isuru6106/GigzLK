import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTrustedAssertionIssuers } from './assertion-key-config';

describe('loadTrustedAssertionIssuers', () => {
  const errorMessage = 'Unable to load service assertion key configuration.';
  const issuer = 'urn:gigzlk:local:bff:marketplace';
  const audience = 'urn:gigzlk:local:auth-internal';
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ format: 'pem', type: 'spki' }).toString();

  let directory: string;
  let filePath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'gigzlk-assertion-keys-'));
    filePath = join(directory, 'keys.json');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('loads the configured identity and public key from a JSON file', () => {
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

    const trusted = loadTrustedAssertionIssuers(filePath).get(issuer);

    expect(trusted?.subject).toBe('marketplace-bff');
    expect(trusted?.audience).toBe(audience);
    expect(trusted?.keys.get('current')?.equals(publicKey)).toBe(true);
  });

  it('rejects an unset path', () => {
    expect(() => loadTrustedAssertionIssuers(undefined)).toThrow(errorMessage);
  });

  it('rejects a missing file without exposing its path', () => {
    expect(() => loadTrustedAssertionIssuers(filePath)).toThrow(
      new Error(errorMessage),
    );
  });

  it.each([
    '{',
    '{}',
    '[]',
    '[{"issuer":123}]',
    JSON.stringify([
      {
        issuer,
        subject: 'marketplace-bff',
        audience,
        keys: [{ kid: 'current', pem: 123 }],
      },
    ]),
  ])('rejects invalid configuration: %s', (contents) => {
    writeFileSync(filePath, contents, 'utf8');

    expect(() => loadTrustedAssertionIssuers(filePath)).toThrow(errorMessage);
  });
});
