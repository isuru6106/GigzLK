import type { Payment } from '../generated/prisma/client';

export function toPaymentResponse(payment: Payment) {
  return {
    paymentId: payment.id,
    assignmentId: payment.assignmentId,
    grossMinor: payment.grossMinor.toString(),
    currency: payment.currency,
    fundedAt: payment.fundedAt?.toISOString() ?? null,
    approvedAt: payment.approvedAt?.toISOString() ?? null,
    holdActive: payment.holdActive,
    releasedAt: payment.releasedAt?.toISOString() ?? null,
    version: payment.version,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}
