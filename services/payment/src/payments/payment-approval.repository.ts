import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { Prisma } from '../generated/prisma/client';
import { toPaymentResponse } from './payment-response';

export class ApprovalConflictError extends Error {
  constructor(
    readonly code:
      'PAYMENT_NOT_FOUND' | 'PAYMENT_STATE_CONFLICT' | 'IDEMPOTENCY_CONFLICT',
  ) {
    super(code);
    this.name = 'ApprovalConflictError';
  }
}

@Injectable()
export class PaymentApprovalRepository {
  constructor(private readonly database: DatabaseService) {}

  async approve(
    paymentId: string,
    callerId: string,
    idempotencyKey: string,
    expectedVersion: number,
  ): Promise<Prisma.JsonValue> {
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (
      !uuidPattern.test(paymentId) ||
      !uuidPattern.test(callerId) ||
      typeof idempotencyKey !== 'string' ||
      !/^[\x21-\x7E]{1,128}$/.test(idempotencyKey) ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0
    ) {
      throw new Error('Invalid internal approval input');
    }

    // UUIDs represent the same identity regardless of letter case.
    paymentId = paymentId.toLowerCase();
    callerId = callerId.toLowerCase();

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const previous = await tx.paymentApprovalRequest.findUnique({
              where: {
                callerId_idempotencyKey: {
                  callerId,
                  idempotencyKey,
                },
              },
            });

            if (previous) {
              if (previous.paymentId !== paymentId) {
                throw new ApprovalConflictError('IDEMPOTENCY_CONFLICT');
              }

              return previous.response;
            }

            const payment = await tx.payment.findUnique({
              where: { id: paymentId },
            });

            if (!payment) {
              throw new ApprovalConflictError('PAYMENT_NOT_FOUND');
            }

            if (
              payment.version !== expectedVersion ||
              !payment.fundedAt ||
              payment.approvedAt ||
              payment.releasedAt ||
              payment.holdActive
            ) {
              throw new ApprovalConflictError('PAYMENT_STATE_CONFLICT');
            }

            const changed = await tx.payment.updateMany({
              where: {
                id: paymentId,
                version: expectedVersion,
                fundedAt: { not: null },
                approvedAt: null,
                releasedAt: null,
                holdActive: false,
              },
              data: {
                approvedAt: new Date(),
                version: { increment: 1 },
              },
            });

            if (changed.count !== 1) {
              throw new ApprovalConflictError('PAYMENT_STATE_CONFLICT');
            }

            const approved = await tx.payment.findUniqueOrThrow({
              where: { id: paymentId },
            });

            const response = toPaymentResponse(approved);

            await tx.paymentApprovalRequest.create({
              data: {
                callerId,
                idempotencyKey,
                paymentId,
                response,
              },
            });

            return response;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002');

        if (!retryable || attempt === 2) {
          throw error;
        }
      }
    }

    throw new Error('Approval could not be completed');
  }
}
