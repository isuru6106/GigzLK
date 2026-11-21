import {
  Controller,
  HttpCode,
  INestApplication,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { Request } from 'express';
import request from 'supertest';
import { configureHttp } from '../src/configure-http';
import { AssertionAdmissionService } from '../src/service-auth/assertion-admission.service';
import { AssertionKeysService } from '../src/service-auth/assertion-keys.service';
import { AssertionReplayService } from '../src/service-auth/assertion-replay.service';
import { validateServiceAssertion } from '../src/service-auth/assertion-validator';
import { InternalAuthHttpService } from '../src/service-auth/internal-auth-http.service';
import type { Server } from 'node:http';

let handlerCalls = 0;

@Controller('internal/v1/auth')
class ProtectedTestController {
  constructor(private readonly httpAuth: InternalAuthHttpService) {}

  @Post('login')
  @HttpCode(200)
  login(@Req() req: Request) {
    return this.httpAuth.execute(req, () => {
      handlerCalls += 1;
      return { status: 'TEST_ONLY' };
    });
  }

  @Post('mfa/challenge')
  @HttpCode(200)
  mfa(@Req() req: Request) {
    return this.login(req);
  }
}

describe('Internal service authentication over HTTP', () => {
  const marketplace = 'urn:gigzlk:local:bff:marketplace';
  const admin = 'urn:gigzlk:local:bff:admin';
  const audience = 'urn:gigzlk:local:auth-internal';
  const marketplaceKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const adminKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });

  const trusted = new Map([
    [
      marketplace,
      {
        issuer: marketplace,
        subject: 'marketplace-bff',
        audience,
        keys: new Map([['current', marketplaceKeys.publicKey]]),
      },
    ],
    [
      admin,
      {
        issuer: admin,
        subject: 'admin-bff',
        audience,
        keys: new Map([['current', adminKeys.publicKey]]),
      },
    ],
  ]);

  const consumed = new Set<string>();
  const consume = jest.fn<Promise<void>, [string, string, Date]>();
  let app: INestApplication;
  let previousMarketplace: string | undefined;
  let previousAdmin: string | undefined;

  function token(useAdmin = false, wrongKey = false): string {
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const iat = Math.floor(Date.now() / 1000);
    const header = encode({
      alg: 'RS256',
      typ: 'gigzlk-service-assertion+jwt',
      kid: 'current',
    });
    const payload = encode({
      iss: useAdmin ? admin : marketplace,
      sub: useAdmin ? 'admin-bff' : 'marketplace-bff',
      aud: audience,
      jti: randomBytes(16).toString('hex'),
      iat,
      exp: iat + 60,
    });
    const input = `${header}.${payload}`;
    const signer = useAdmin !== wrongKey ? adminKeys : marketplaceKeys;
    const signature = sign('sha256', Buffer.from(input), signer.privateKey);

    return `${input}.${signature.toString('base64url')}`;
  }

  beforeAll(async () => {
    previousMarketplace = process.env.AUTH_MARKETPLACE_BFF_ISSUER;
    previousAdmin = process.env.AUTH_ADMIN_BFF_ISSUER;
    process.env.AUTH_MARKETPLACE_BFF_ISSUER = marketplace;
    process.env.AUTH_ADMIN_BFF_ISSUER = admin;

    const moduleRef = await Test.createTestingModule({
      controllers: [ProtectedTestController],
      providers: [
        InternalAuthHttpService,
        AssertionAdmissionService,
        {
          provide: AssertionKeysService,
          useValue: {
            validate: (value: string) =>
              validateServiceAssertion(value, trusted),
          },
        },
        { provide: AssertionReplayService, useValue: { consume } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  beforeEach(() => {
    handlerCalls = 0;
    consumed.clear();
    consume.mockReset().mockImplementation((issuer, jti) => {
      const key = `${issuer}:${jti}`;
      if (consumed.has(key)) {
        return Promise.reject(
          new UnauthorizedException({ code: 'SERVICE_AUTH_INVALID' }),
        );
      }
      consumed.add(key);
      return Promise.resolve();
    });
  });

  afterAll(async () => {
    await app.close();

    for (const [name, value] of [
      ['AUTH_MARKETPLACE_BFF_ISSUER', previousMarketplace],
      ['AUTH_ADMIN_BFF_ISSUER', previousAdmin],
    ] as const) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it('admits a valid signed request', async () => {
    await request(app.getHttpServer() as Server)
      .post('/internal/v1/auth/login')
      .set('Authorization', `Bearer ${token()}`)
      .expect('Cache-Control', 'no-store')
      .expect(200, { status: 'TEST_ONLY' });

    expect(handlerCalls).toBe(1);
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing assertion without consuming replay storage', async () => {
    await request(app.getHttpServer() as Server)
      .post('/internal/v1/auth/login')
      .expect('Cache-Control', 'no-store')
      .expect(401);

    expect(handlerCalls).toBe(0);
    expect(consume).not.toHaveBeenCalled();
  });

  it('rejects a signature from the wrong key', async () => {
    await request(app.getHttpServer() as Server)
      .post('/internal/v1/auth/login')
      .set('Authorization', `Bearer ${token(false, true)}`)
      .expect('Cache-Control', 'no-store')
      .expect(401);

    expect(handlerCalls).toBe(0);
    expect(consume).not.toHaveBeenCalled();
  });

  it('rejects marketplace access to admin MFA', async () => {
    await request(app.getHttpServer() as Server)
      .post('/internal/v1/auth/mfa/challenge')
      .set('Authorization', `Bearer ${token()}`)
      .expect('Cache-Control', 'no-store')
      .expect(403);

    expect(handlerCalls).toBe(0);
    expect(consume).not.toHaveBeenCalled();
  });

  it('rejects reuse of the same assertion', async () => {
    const authorization = `Bearer ${token()}`;

    await request(app.getHttpServer() as Server)
      .post('/internal/v1/auth/login')
      .set('Authorization', authorization)
      .expect(200);

    await request(app.getHttpServer() as Server)
      .post('/internal/v1/auth/login')
      .set('Authorization', authorization)
      .expect('Cache-Control', 'no-store')
      .expect(401);

    expect(handlerCalls).toBe(1);
  });

  it('fails closed when replay storage is unavailable', async () => {
    consume.mockRejectedValueOnce(
      new ServiceUnavailableException({ code: 'AUTH_UNAVAILABLE' }),
    );

    await request(app.getHttpServer() as Server)
      .post('/internal/v1/auth/login')
      .set('Authorization', `Bearer ${token()}`)
      .expect('Cache-Control', 'no-store')
      .expect(503);

    expect(handlerCalls).toBe(0);
  });
});
