import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PaymentAssignmentClient,
  PaymentSessionClient,
} from './payment-access.clients';
import { PaymentRepository } from './payment.repository';
import { toPaymentResponse } from './payment-response';

@Injectable()
export class PaymentReadService {
  constructor(
    private readonly sessions: PaymentSessionClient,
    private readonly assignments: PaymentAssignmentClient,
    private readonly repository: PaymentRepository,
  ) {}

  async read(paymentId: string, accessToken: string) {
    const principal = await this.sessions.checkSession(accessToken);

    const payment = await this.repository.findById(paymentId).catch(() => {
      throw new ServiceUnavailableException({
        code: 'PAYMENT_UNAVAILABLE',
        message: 'Payment storage is unavailable',
      });
    });

    if (!payment) {
      throw this.notFound();
    }

    const allowed = await this.assignments.canReadPayment(
      principal.accountId,
      payment.assignmentId,
    );

    if (allowed !== true) {
      throw this.notFound();
    }

    return toPaymentResponse(payment);
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'PAYMENT_NOT_FOUND',
      message: 'Payment not found',
    });
  }
}
