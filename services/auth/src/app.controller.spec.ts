import { ServiceUnavailableException } from '@nestjs/common';
import { AppController } from './app.controller';

describe('AppController', () => {
  const database = { checkReadiness: jest.fn() };
  const controller = new AppController(database);

  beforeEach(() => {
    database.checkReadiness.mockReset();
  });

  it('reports liveness without querying the database', () => {
    expect(controller.live()).toEqual({ status: 'UP', service: 'auth' });
    expect(database.checkReadiness).not.toHaveBeenCalled();
  });

  it('reports readiness when the database check succeeds', async () => {
    database.checkReadiness.mockResolvedValue(undefined);
    await expect(controller.ready()).resolves.toEqual({
      status: 'UP',
      service: 'auth',
    });
  });

  it('returns a safe 503 response when the database check fails', async () => {
    database.checkReadiness.mockRejectedValue(
      new Error('Sensitive database connection details'),
    );

    try {
      await controller.ready();
      throw new Error('Expected readiness to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const exception = error as ServiceUnavailableException;
      expect(exception.getStatus()).toBe(503);
      expect(exception.getResponse()).toEqual({
        status: 'DOWN',
        service: 'auth',
      });
    }
  });
});
