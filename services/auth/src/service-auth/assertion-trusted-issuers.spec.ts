import { generateKeyPairSync } from 'node:crypto';
import { buildTrustedAssertionIssuers } from './assertion-trusted-issuers';

describe('buildTrustedAssertionIssuers', () => {
  function makeKey() {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    return {
      publicKey,
      pem: publicKey.export({ format: 'pem', type: 'spki' }),
    };
  }

  const marketplaceKey = makeKey();
  const adminKey = makeKey();
  const rotatedKey = makeKey();
  const audience = 'urn:gigzlk:local:auth-internal';

  const marketplace = {
    issuer: 'urn:gigzlk:local:bff:marketplace',
    subject: 'marketplace-bff',
    audience,
    keys: [{ kid: 'current', pem: marketplaceKey.pem }],
  };
  const admin = {
    issuer: 'urn:gigzlk:local:bff:admin',
    subject: 'admin-bff',
    audience,
    keys: [{ kid: 'current', pem: adminKey.pem }],
  };

  it('scopes the same kid to different keys for different issuers', () => {
    const issuers = buildTrustedAssertionIssuers([marketplace, admin]);

    expect(
      issuers
        .get(marketplace.issuer)
        ?.keys.get('current')
        ?.equals(marketplaceKey.publicKey),
    ).toBe(true);
    expect(
      issuers
        .get(admin.issuer)
        ?.keys.get('current')
        ?.equals(adminKey.publicKey),
    ).toBe(true);
  });

  it('allows old and new keys for the same issuer during rotation', () => {
    const issuers = buildTrustedAssertionIssuers([
      {
        ...marketplace,
        keys: [...marketplace.keys, { kid: 'next', pem: rotatedKey.pem }],
      },
    ]);

    const keys = issuers.get(marketplace.issuer)?.keys;
    expect(keys?.get('current')?.equals(marketplaceKey.publicKey)).toBe(true);
    expect(keys?.get('next')?.equals(rotatedKey.publicKey)).toBe(true);
  });

  it('rejects the same public key across issuers even with different kids', () => {
    expect(() =>
      buildTrustedAssertionIssuers([
        marketplace,
        {
          ...admin,
          keys: [{ kid: 'different', pem: marketplaceKey.pem }],
        },
      ]),
    ).toThrow('Invalid service assertion issuer configuration.');
  });

  it('rejects duplicate kids within one issuer', () => {
    expect(() =>
      buildTrustedAssertionIssuers([
        {
          ...marketplace,
          keys: [...marketplace.keys, { kid: 'current', pem: rotatedKey.pem }],
        },
      ]),
    ).toThrow('Invalid service assertion issuer configuration.');
  });
});
