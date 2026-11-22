import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { Prisma } from '../generated/prisma/client';
import { calculateCommission } from './commission';
import { createReleaseJournal } from './release-journal';
import { randomUUID } from 'node:crypto';

@Injectable()
export class PaymentReleaseService {
  constructor(private readonly database: DatabaseService) {}

  async release(paymentId: string, callerId: string, idempotencyKey: string) {
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (typeof paymentId !== 'string' || !uuidPattern.test(paymentId)) {
      throw new Error('A valid payment UUID is required');
    }

    this.requireIdentifier(callerId, 100);
    this.requireIdentifier(idempotencyKey, 128);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const previous = await tx.releaseJournal.findUnique({
              where: {
                callerId_idempotencyKey: { callerId, idempotencyKey },
              },
              include: {
                entries: { orderBy: { position: 'asc' } },
              },
            });

            if (previous) {
              if (previous.paymentId !== paymentId) {
                throw new Error('Idempotency key belongs to another payment');
              }

              return previous;
            }

            const payment = await tx.payment.findUnique({
              where: { id: paymentId },
            });

            if (!payment) {
              throw new Error('Payment not found');
            }

            if (
              !payment.fundedAt ||
              !payment.approvedAt ||
              payment.holdActive ||
              payment.releasedAt
            ) {
              throw new Error('Payment is not eligible for release');
            }

            const grossMinor = Number(payment.grossMinor);
            const amounts = calculateCommission(grossMinor);
            const lines = createReleaseJournal(grossMinor);

            const releasedAt = new Date();

            const changed = await tx.payment.updateMany({
              where: {
                id: paymentId,
                version: payment.version,
                fundedAt: { not: null },
                approvedAt: { not: null },
                holdActive: false,
                releasedAt: null,
              },
              data: {
                releasedAt,
                version: { increment: 1 },
              },
            });

            if (changed.count !== 1) {
              throw new Error('Payment state changed before release');
            }

            const journal = await tx.releaseJournal.create({
              data: {
                paymentId,
                callerId,
                idempotencyKey,
                grossMinor: BigInt(amounts.grossMinor),
                commissionMinor: BigInt(amounts.commissionMinor),
                netMinor: BigInt(amounts.netMinor),
                currency: amounts.currency,
                entries: {
                  create: lines.map((line, position) => ({
                    position,
                    account: line.account as
                      | 'PROTECTED_FUNDS'
                      | 'WORKER_PAYABLE'
                      | 'COMMISSION_REVENUE',
                    side: line.side,
                    amountMinor: BigInt(line.amountMinor),
                    currency: line.currency,
                  })),
                },
              },
              include: {
                entries: { orderBy: { position: 'asc' } },
              },
            });
            await tx.outboxEvent.create({
              data: {
                eventType: 'PAYMENT_RELEASED',
                schemaVersion: 1,
                producer: 'payment',
                aggregateId: payment.id,
                aggregateVersion: payment.version + 1,
                occurredAt: releasedAt,
                correlationId: randomUUID(),
                data: {
                  paymentId: payment.id,
                  assignmentId: payment.assignmentId,
                  releaseJournalId: journal.id,
                  grossMinor: journal.grossMinor.toString(),
                  commissionMinor: journal.commissionMinor.toString(),
                  netMinor: journal.netMinor.toString(),
                  currency: journal.currency,
                  releasedAt: releasedAt.toISOString(),
                },
              },
            });

            return journal;
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

    throw new Error('Release could not be completed');
  }

  private requireIdentifier(value: string, maxLength: number): void {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > maxLength ||
      value !== value.trim()
    ) {
      throw new Error(
        'A nonblank identifier without surrounding spaces is required',
      );
    }
  }
}
