import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  constants,
  createPublicKey,
  generateKeyPairSync,
  verify,
} from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { AccessSigningKeyService } from '../src/access-tokens/access-signing-key.service';
import { configureHttp } from '../src/configure-http';
import { DatabaseService } from '../src/database.service';

describe('Access JWKS (e2e)', () => {
  const envNames = [
    'AUTH_ACCESS_SIGNING_KID',
    'AUTH_ACCESS_PRIVATE_KEY_FILE',
    'AUTH_ACCESS_PUBLIC_KEY_FILE',
    'AUTH_ASSERTION_KEYS_FILE',
  ] as const;

  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });

  let originals: Map<string, string | undefined>;
  let directory: string;
  let app: INestApplication | undefined;
  let port: number;

  beforeEach(() => {
    originals = new Map(envNames.map((name) => [name, process.env[name]]));

    for (const name of envNames) {
      delete process.env[name];
    }

    directory = mkdtempSync(join(tmpdir(), 'gigzlk-jwks-'));

    const privatePath = join(directory, 'private.pem');
    const publicPath = join(directory, 'public.pem');

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

  afterEach(async () => {
    try {
      if (app) {
        await app.close();
      }
    } finally {
      app = undefined;

      for (const [name, value] of originals) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }

      rmSync(directory, { recursive: true, force: true });
    }
  });

  async function start() {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    configureHttp(app);
    await app.listen(0, '127.0.0.1');

    const server = app.getHttpServer() as Server;
    port = (server.address() as AddressInfo).port;

    return app;
  }

  function send(method: string, path: string) {
    return new Promise<{
      status: number | undefined;
      cacheControl: string | undefined;
      location: string | undefined;
      body: string;
    }>((resolve, reject) => {
      const outgoing = request(
        { hostname: '127.0.0.1', port, method, path },
        (response) => {
          const chunks: Buffer[] = [];

          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () => {
            resolve({
              status: response.statusCode,
              cacheControl: response.headers['cache-control'],
              location: response.headers.location,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );

      outgoing.on('error', reject);
      outgoing.end();
    });
  }

  it('publishes exactly the public fields and permits signature verification', async () => {
    const runningApp = await start();
    const result = await send('GET', '/.well-known/jwks.json');

    expect(result.status).toBe(200);
    expect(result.cacheControl).toBe('public, max-age=60');
    expect(result.location).toBeUndefined();

    const exported = pair.publicKey.export({ format: 'jwk' });
    const expectedKey = {
      kty: 'RSA',
      use: 'sig',
      alg: 'RS256',
      kid: 'access-current',
      n: exported.n,
      e: exported.e,
    };

    const body: unknown = JSON.parse(result.body);
    expect(body).toEqual({ keys: [expectedKey] });

    // Construct the verification key from the HTTP response.
    const published = JSON.parse(result.body) as {
      keys: {
        kty: string;
        use: string;
        alg: string;
        kid: string;
        n: string;
        e: string;
      }[];
    };

    const verificationKey = createPublicKey({
      key: published.keys[0],
      format: 'jwk',
    });

    const now = Date.now();
    const signed = runningApp.get(AccessSigningKeyService).sign({
      issuer: 'urn:gigzlk:local:auth',
      accountId: 'b5718a95-f11f-4cfe-91dc-55d595af8dbc',
      sessionId: 'ddce7093-c348-401a-a59e-1493fcbebdeb',
      sessionExpiresAt: new Date(now + 3_600_000),
      authenticatedAt: new Date(now - 60_000),
    });

    const [header, payload, signature] = signed.accessToken.split('.');

    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${payload}`, 'ascii'),
        {
          key: verificationKey,
          padding: constants.RSA_PKCS1_PADDING,
        },
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
  });

  it('returns an uncached operational error without configured keys', async () => {
    delete process.env.AUTH_ACCESS_SIGNING_KID;
    delete process.env.AUTH_ACCESS_PRIVATE_KEY_FILE;
    delete process.env.AUTH_ACCESS_PUBLIC_KEY_FILE;

    await start();

    const result = await send('GET', '/.well-known/jwks.json');

    expect(result.status).toBe(503);
    expect(result.cacheControl).toBe('no-store');

    const body: unknown = JSON.parse(result.body);
    expect(body).toEqual({
      code: 'AUTH_UNAVAILABLE',
      message: 'Access-token discovery is unavailable.',
    });
  });

  it.each([
    '/.well-known/jwks.json/',
    '/.well-known/jwks.json?',
    '/.well-known/jwks.json?next=home',
    '/.WELL-KNOWN/jwks.json',
    '/.well-known/JWKS.json',
    '/.well-known/%6awks.json',
    '/%2ewell-known/jwks.json',
    '/.well-known//jwks.json',
    '/.well-known/./jwks.json',
    '/.well-known/jwks.json;extra',
    '/.well-known/unknown',
  ])('rejects alternate discovery targets: %s', async (path) => {
    await start();

    const result = await send('GET', path);

    expect(result.status).toBe(404);
    expect(result.cacheControl).toBe('no-store');
    expect(result.location).toBeUndefined();
  });

  it.each(['HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    'rejects discovery method: %s',
    async (method) => {
      await start();

      const result = await send(method, '/.well-known/jwks.json');

      expect(result.status).toBe(404);
      expect(result.cacheControl).toBe('no-store');
      expect(result.location).toBeUndefined();
    },
  );
});
