import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export interface PaymentPrincipal {
  accountId: string;
}

@Injectable()
export class PaymentSessionClient {
  checkSession(_accessToken: string): Promise<PaymentPrincipal> {
    void _accessToken;
    return Promise.reject(
      new ServiceUnavailableException({
        code: 'AUTH_UNAVAILABLE',
        message: 'Session validation is unavailable',
      }),
    );
  }
}

@Injectable()
export class PaymentAssignmentClient {
  canReadPayment(_accountId: string, _assignmentId: string): Promise<boolean> {
    void _accountId;
    void _assignmentId;
    return Promise.reject(
      new ServiceUnavailableException({
        code: 'ASSIGNMENT_UNAVAILABLE',
        message: 'Assignment validation is unavailable',
      }),
    );
  }
  canApprovePayment(accountId: string, assignmentId: string): Promise<boolean> {
    void accountId;
    void assignmentId;

    return Promise.reject(
      new ServiceUnavailableException({
        code: 'ASSIGNMENT_UNAVAILABLE',
        message: 'Assignment validation is unavailable',
      }),
    );
  }
}

@Injectable()
export class PaymentCompletionClient {
  isCompleted(assignmentId: string): Promise<boolean> {
    void assignmentId;

    return Promise.reject(
      new ServiceUnavailableException({
        code: 'COMPLETION_UNAVAILABLE',
        message: 'Completion validation is unavailable',
      }),
    );
  }
}
