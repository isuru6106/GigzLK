import { INestApplication } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

export function configureHttp(app: INestApplication): void {
  app.use(
    '/api/v1/auth',
    (_request: Request, response: Response, next: NextFunction) => {
      response.setHeader('Cache-Control', 'no-store');
      next();
    },
  );
}
