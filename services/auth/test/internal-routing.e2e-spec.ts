import { Controller, INestApplication, Module, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { configureHttp } from '../src/configure-http';

let handlerCalls = 0;

@Controller('internal/v1/auth')
class TestInternalController {
  @Post('login')
  login() {
    handlerCalls += 1;
    return { status: 'TEST_ONLY' };
  }
}

@Module({ controllers: [TestInternalController] })
class TestRoutingModule {}

describe('Internal Auth routing (e2e)', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestRoutingModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureHttp(app);
    await app.listen(0, '127.0.0.1');

    const server = app.getHttpServer() as Server;
    const address = server.address() as AddressInfo;
    port = address.port;
  });

  beforeEach(() => {
    handlerCalls = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  function send(method: string, path: string) {
    return new Promise<{
      status: number | undefined;
      cacheControl: string | undefined;
      location: string | undefined;
    }>((resolve, reject) => {
      const outgoing = request(
        { hostname: '127.0.0.1', port, method, path },
        (response) => {
          response.resume();
          response.on('error', reject);
          response.on('end', () => {
            resolve({
              status: response.statusCode,
              cacheControl: response.headers['cache-control'],
              location: response.headers.location,
            });
          });
        },
      );

      outgoing.on('error', reject);
      outgoing.end();
    });
  }

  it('allows the exact POST path to reach the test handler', async () => {
    const result = await send('POST', '/internal/v1/auth/login');

    expect(result.status).toBe(201);
    expect(result.cacheControl).toBe('no-store');
    expect(handlerCalls).toBe(1);
  });

  it.each([
    '/internal/v1/auth/login/',
    '/internal/v1/auth/login?',
    '/internal/v1/auth/login?next=home',
    '/internal/v1/auth/%6cogin',
    '/internal/v1/auth//login',
    '/internal/v1/auth/./login',
    '/internal/v1/auth/../auth/login',
    '/internal/v1/auth\\login',
    '/internal/v1/auth/login;extra',
    '/INTERNAL/v1/auth/login',
    '/internal/v1/auth/unknown',
  ])('rejects the original target without redirecting: %s', async (path) => {
    const result = await send('POST', path);

    expect(result.status).toBe(404);
    expect(result.cacheControl).toBe('no-store');
    expect(result.location).toBeUndefined();
    expect(handlerCalls).toBe(0);
  });

  it.each(['GET', 'PUT', 'DELETE', 'OPTIONS'])(
    'rejects an unapproved method: %s',
    async (method) => {
      const result = await send(method, '/internal/v1/auth/login');

      expect(result.status).toBe(404);
      expect(result.cacheControl).toBe('no-store');
      expect(handlerCalls).toBe(0);
    },
  );
});
