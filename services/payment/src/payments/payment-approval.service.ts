import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PaymentAssignmentClient,
  PaymentCompletionClient,
  PaymentSessionClient,
} from './payment-access.clients';
import {
  ApprovalConflictError,
  PaymentApprovalRepository,
} from './payment-approval.repository';
import { PaymentRepository } from './payment.repository';

@Injectable()
export class PaymentApprovalService {
  constructor(
    private readonly sessions: PaymentSessionClient,
    private readonly assignments: PaymentAssignmentClient,
    private readonly completion: PaymentCompletionClient,
    private readonly repository: PaymentRepository,
    private readonly approvals: PaymentApprovalRepository,
  ) {}

  async approve(
    paymentId: string,
    accessToken: string,
    idempotencyKey: string,
  ) {
    const principal = await this.sessions.checkSession(accessToken);

    const payment = await this.repository.findById(paymentId).catch(() => {
      throw this.unavailable();
    });

    if (!payment) {
      throw this.notFound();
    }

    const allowed = await this.assignments.canApprovePayment(
      principal.accountId,
      payment.assignmentId,
    );

    if (allowed !== true) {
      throw this.notFound();
    }

    const completed = await this.completion.isCompleted(payment.assignmentId);

    if (completed !== true) {
      throw new ConflictException({
        code: 'PAYMENT_STATE_CONFLICT',
        message: 'Payment state does not permit this operation',
      });
    }

    try {
      return await this.approvals.approve(
        paymentId,
        principal.accountId,
        idempotencyKey,
        payment.version,
      );
    } catch (error) {
      if (error instanceof ApprovalConflictError) {
        if (error.code === 'PAYMENT_NOT_FOUND') {
          throw this.notFound();
        }

        throw new ConflictException({
          code: error.code,
          message:
            error.code === 'IDEMPOTENCY_CONFLICT'
              ? 'Idempotency key conflicts with an existing request'
              : 'Payment state does not permit this operation',
        });
      }

      throw this.unavailable();
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'PAYMENT_NOT_FOUND',
      message: 'Payment not found',
    });
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'PAYMENT_UNAVAILABLE',
      message: 'Payment storage is unavailable',
    });
  }
}
