import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentReadService } from './payment-read.service';

@Controller('api/v1/payments')
export class PaymentController {
  constructor(private readonly payments: PaymentReadService) {}

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
}
