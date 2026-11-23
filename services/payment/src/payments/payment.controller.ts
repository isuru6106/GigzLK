import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  UnauthorizedException,
  UseFilters,
  Body,
  HttpCode,
  Post,
} from '@nestjs/common';
import { PaymentReadService } from './payment-read.service';
import { PaymentApprovalService } from './payment-approval.service';
import { PaymentExceptionFilter } from './payment-exception.filter';
@Controller('api/v1/payments')
@UseFilters(PaymentExceptionFilter)
export class PaymentController {
  constructor(
    private readonly payments: PaymentReadService,
    private readonly approvals: PaymentApprovalService,
  ) {}

  @Get(':paymentId')
  read(
    @Param('paymentId') paymentId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const match =
      typeof authorization === 'string'
        ? /^Bearer ([\x21-\x7E]+)$/i.exec(authorization)
        : null;

    if (!match || match[1].length > 4096) {
      throw new UnauthorizedException({
        code: 'SESSION_INVALID',
        message: 'A valid access credential is required',
      });
    }

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(paymentId)) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'A valid payment UUID is required',
      });
    }

    return this.payments.read(paymentId, match[1]);
  }

  @Post(':paymentId/approve')
  @HttpCode(200)
  approve(
    @Param('paymentId') paymentId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const match =
      typeof authorization === 'string'
        ? /^Bearer ([\x21-\x7E]+)$/i.exec(authorization)
        : null;

    if (!match || match[1].length > 4096) {
      throw new UnauthorizedException({
        code: 'SESSION_INVALID',
        message: 'A valid access credential is required',
      });
    }

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const emptyBody =
      body === undefined ||
      (typeof body === 'object' &&
        body !== null &&
        !Array.isArray(body) &&
        Object.keys(body).length === 0);

    if (
      !uuidPattern.test(paymentId) ||
      typeof idempotencyKey !== 'string' ||
      !/^[\x21-\x7E]{1,128}$/.test(idempotencyKey) ||
      !emptyBody
    ) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Invalid payment request',
      });
    }

    return this.approvals.approve(
      paymentId.toLowerCase(),
      match[1],
      idempotencyKey,
    );
  }
}
