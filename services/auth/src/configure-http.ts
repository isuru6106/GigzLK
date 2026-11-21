import { INestApplication } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { resolveInternalAuthOperation } from './service-auth/assertion-operation';

export function configureHttp(app: INestApplication): void {
  app.use(
    '/api/v1/auth',
    (_request: Request, response: Response, next: NextFunction) => {
      response.setHeader('Cache-Control', 'no-store');
      next();
    },
  );

  app.use((request: Request, response: Response, next: NextFunction) => {
    const originalTarget = request.originalUrl;

    if (!originalTarget.toLowerCase().startsWith('/internal')) {
      next();
      return;
    }

    response.setHeader('Cache-Control', 'no-store');

    const operation = resolveInternalAuthOperation(
      request.method,
      originalTarget,
    );

    if (operation === undefined) {
      response.status(404).json({
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
      });
      return;
    }

    next();
  });
}
