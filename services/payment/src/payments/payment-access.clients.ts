import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export interface PaymentPrincipal {
  accountId: string;
}

@Injectable()
export class PaymentSessionClient {
  checkSession(_accessToken: string): Promise<PaymentPrincipal> {
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
    return Promise.reject(
      new ServiceUnavailableException({
        code: 'ASSIGNMENT_UNAVAILABLE',
        message: 'Assignment validation is unavailable',
      }),
    );
  }
}
