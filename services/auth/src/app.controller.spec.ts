import { AppController } from './app.controller';

describe('AppController', () => {
  const controller = new AppController();

  it('reports liveness', () => {
    expect(controller.live()).toEqual({ status: 'UP', service: 'auth' });
  });

  it('reports readiness for the dependency-free foundation', () => {
    expect(controller.ready()).toEqual({ status: 'UP', service: 'auth' });
  });
});
