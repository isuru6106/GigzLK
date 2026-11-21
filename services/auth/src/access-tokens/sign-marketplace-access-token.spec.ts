import { constants, generateKeyPairSync, verify } from 'node:crypto';
import { parseAccessSigningKey } from './access-signing-key';
import type { MarketplaceAccessClaimsInput } from './marketplace-access-claims';
import { signMarketplaceAccessToken } from './sign-marketplace-access-token';

describe('signMarketplaceAccessToken', () => {
  const nowMs = Date.parse('2026-11-21T10:00:00.750Z');

  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  const otherPair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  const key = parseAccessSigningKey(
    'access-current',
    pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    pair.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  );

  function input(): MarketplaceAccessClaimsInput {
    return {
      issuer: 'urn:gigzlk:local:auth',
      accountId: 'b5718a95-f11f-4cfe-91dc-55d595af8dbc',
      sessionId: 'ddce7093-c348-401a-a59e-1493fcbebdeb',
      sessionExpiresAt: new Date(nowMs + 7 * 24 * 60 * 60 * 1000),
      authenticatedAt: new Date(nowMs - 60_000),
    };
  }

  function sections(token: string) {
    const parts = token.split('.');

    expect(parts).toHaveLength(3);

    return {
      header: parts[0],
      payload: parts[1],
      signature: Buffer.from(parts[2], 'base64url'),
      signingInput: Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'),
    };
  }

  it('uses the agreed protected header and produces a valid signature', () => {
    const result = signMarketplaceAccessToken(input(), key, nowMs);
    const token = sections(result.accessToken);

    const header: unknown = JSON.parse(
      Buffer.from(token.header, 'base64url').toString('utf8'),
    );

    expect(header).toEqual({
      alg: 'RS256',
      typ: 'at+jwt',
      kid: 'access-current',
    });

    expect(
      verify(
        'sha256',
        token.signingInput,
        {
          key: key.publicKey,
          padding: constants.RSA_PKCS1_PADDING,
        },
        token.signature,
      ),
    ).toBe(true);
  });

  it('includes the agreed marketplace claims', () => {
    const source = input();
    const result = signMarketplaceAccessToken(source, key, nowMs);
    const token = sections(result.accessToken);

    const claims: unknown = JSON.parse(
      Buffer.from(token.payload, 'base64url').toString('utf8'),
    );

    expect(claims).toMatchObject({
      iss: source.issuer,
      sub: source.accountId,
      aud: 'marketplace',
      sid: source.sessionId,
      iat: Math.floor(nowMs / 1000),
      exp: Math.floor(nowMs / 1000) + 600,
      auth_time: Math.floor(source.authenticatedAt.getTime() / 1000),
      amr: ['pwd'],
    });

    expect(result.accessExpiresAt).toEqual(
      new Date((Math.floor(nowMs / 1000) + 600) * 1000),
    );
  });

  it('caps access expiry at the session deadline', () => {
    const source = input();
    source.sessionExpiresAt = new Date(nowMs + 30_123);

    const result = signMarketplaceAccessToken(source, key, nowMs);

    expect(result.accessExpiresAt.getTime()).toBe(
      Math.floor(source.sessionExpiresAt.getTime() / 1000) * 1000,
    );
  });

  it('does not verify with another RSA key', () => {
    const result = signMarketplaceAccessToken(input(), key, nowMs);
    const token = sections(result.accessToken);

    expect(
      verify(
        'sha256',
        token.signingInput,
        {
          key: otherPair.publicKey,
          padding: constants.RSA_PKCS1_PADDING,
        },
        token.signature,
      ),
    ).toBe(false);
  });

  it('rejects payload tampering during signature verification', () => {
    const result = signMarketplaceAccessToken(input(), key, nowMs);
    const token = sections(result.accessToken);
    const changedPayload = Buffer.from('{"aud":"admin"}', 'utf8').toString(
      'base64url',
    );

    expect(
      verify(
        'sha256',
        Buffer.from(`${token.header}.${changedPayload}`, 'ascii'),
        {
          key: key.publicKey,
          padding: constants.RSA_PKCS1_PADDING,
        },
        token.signature,
      ),
    ).toBe(false);
  });

  it('produces distinct tokens for separate signing calls', () => {
    const first = signMarketplaceAccessToken(input(), key, nowMs);
    const second = signMarketplaceAccessToken(input(), key, nowMs);

    expect(first.accessToken).not.toBe(second.accessToken);
  });

  it('returns a canonical compact token within the encoded limit', () => {
    const result = signMarketplaceAccessToken(input(), key, nowMs);

    expect(result.accessToken).toMatch(
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
    expect(Buffer.byteLength(result.accessToken, 'ascii')).toBeLessThanOrEqual(
      4096,
    );

    for (const segment of result.accessToken.split('.')) {
      expect(Buffer.from(segment, 'base64url').toString('base64url')).toBe(
        segment,
      );
    }
  });

  it('rejects an expired session with a safe error', () => {
    const source = input();
    source.sessionExpiresAt = new Date(nowMs - 1);

    expect(() => signMarketplaceAccessToken(source, key, nowMs)).toThrow(
      'Unable to sign marketplace access token.',
    );
  });

  it('rejects an oversized claims payload', () => {
    const source = input();
    source.issuer = 'a'.repeat(2048);

    expect(() => signMarketplaceAccessToken(source, key, nowMs)).toThrow(
      'Unable to sign marketplace access token.',
    );
  });

  it('rejects a public key supplied as the signing key', () => {
    expect(() =>
      signMarketplaceAccessToken(
        input(),
        { ...key, privateKey: key.publicKey },
        nowMs,
      ),
    ).toThrow('Unable to sign marketplace access token.');
  });
});
