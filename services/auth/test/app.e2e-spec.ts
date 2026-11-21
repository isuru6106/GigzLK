import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DatabaseService } from './../src/database.service';

describe('Auth health (e2e)', () => {
  let app: INestApplication<App>;
  const database = { checkReadiness: jest.fn() };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue(database)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    database.checkReadiness.mockReset();
    database.checkReadiness.mockResolvedValue(undefined);
  });

  it('reports liveness without accessing the database', async () => {
    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect({ status: 'UP', service: 'auth' });

    expect(database.checkReadiness).not.toHaveBeenCalled();
  });

  it('reports readiness when the database is available', async () => {
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect({ status: 'UP', service: 'auth' });

    expect(database.checkReadiness).toHaveBeenCalledTimes(1);
  });

  it('returns a safe 503 during failure and recovers afterward', async () => {
    database.checkReadiness.mockRejectedValueOnce(
      new Error('Sensitive database connection details'),
    );

    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503)
      .expect({ status: 'DOWN', service: 'auth' });

    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect({ status: 'UP', service: 'auth' });

    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect({ status: 'UP', service: 'auth' });
  });

  it('does not expose the generated greeting', async () => {
    await request(app.getHttpServer()).get('/').expect(404);
  });

  afterAll(async () => {
    await app.close();
  });
});
