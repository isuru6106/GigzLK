export interface VerificationDeliveryInput {
  notificationId: string;
  recipientEmail: string;
  verificationUrl: string;
  expiresAt: Date;
}

export type VerificationDeliveryResult =
  | {
      outcome: 'ACCEPTED';
      providerReference: string;
    }
  | {
      outcome: 'NOT_SENT';
      retryable: boolean;
    }
  | {
      outcome: 'MAY_HAVE_BEEN_SENT';
    };

export interface VerificationDelivery {
  send(input: VerificationDeliveryInput): Promise<VerificationDeliveryResult>;
}

/**
 * Local simulation only.
 *
 * Does not send email, log payloads or retain recipient addresses and links.
 */
export class LocalVerificationDelivery implements VerificationDelivery {
  constructor(
    private readonly simulatedResult:
      | 'ACCEPTED'
      | 'RETRYABLE_FAILURE'
      | 'PERMANENT_FAILURE'
      | 'UNKNOWN' = 'ACCEPTED',
  ) {}

  send(input: VerificationDeliveryInput): Promise<VerificationDeliveryResult> {
    if (this.simulatedResult === 'RETRYABLE_FAILURE') {
      return Promise.resolve({
        outcome: 'NOT_SENT',
        retryable: true,
      });
    }

    if (this.simulatedResult === 'PERMANENT_FAILURE') {
      return Promise.resolve({
        outcome: 'NOT_SENT',
        retryable: false,
      });
    }

    if (this.simulatedResult === 'UNKNOWN') {
      return Promise.resolve({
        outcome: 'MAY_HAVE_BEEN_SENT',
      });
    }

    return Promise.resolve({
      outcome: 'ACCEPTED',
      providerReference: `local-simulation:${input.notificationId}`,
    });
  }
}
