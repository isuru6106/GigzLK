import { randomUUID } from 'node:crypto';
import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

const safeErrors: Record<string, { status: number; message: string }> = {
  INVALID_REQUEST: {
    status: 400,
    message: 'Invalid payment request',
  },
  SESSION_INVALID: {
    status: 401,
    message: 'A valid access credential is required',
  },
  PAYMENT_NOT_FOUND: {
    status: 404,
    message: 'Payment not found',
  },
  AUTH_UNAVAILABLE: {
    status: 503,
    message: 'Session validation is unavailable',
  },
  ASSIGNMENT_UNAVAILABLE: {
    status: 503,
    message: 'Assignment validation is unavailable',
  },
  PAYMENT_UNAVAILABLE: {
    status: 503,
    message: 'Payment storage is unavailable',
  },
  PAYMENT_STATE_CONFLICT: {
    status: 409,
    message: 'Payment state does not permit this operation',
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    message: 'Idempotency key conflicts with an existing request',
  },
  COMPLETION_UNAVAILABLE: {
    status: 503,
    message: 'Completion validation is unavailable',
  },
};

@Catch()
export class PaymentExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let code = 'PAYMENT_INTERNAL_ERROR';
    let status = 500;
    let message = 'Payment request could not be completed';

    if (exception instanceof HttpException) {
      const body: unknown = exception.getResponse();

      if (
        typeof body === 'object' &&
        body !== null &&
        'code' in body &&
        typeof body.code === 'string' &&
        Object.hasOwn(safeErrors, body.code)
      ) {
        const safe = safeErrors[body.code];

        if (safe.status === exception.getStatus()) {
          code = body.code;
          status = safe.status;
          message = safe.message;
        }
      }
    }

    const existingId = response.getHeader('X-Request-ID');
    const requestId =
      typeof existingId === 'string' ? existingId : randomUUID();

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Request-ID', requestId);
    response.status(status).json({ code, message, requestId });
  }
}
