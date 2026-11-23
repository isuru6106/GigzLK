import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { Prisma } from '../generated/prisma/client';

type SimulatedOutcome = 'SUCCEEDED' | 'FAILED';

@Injectable()
export class SimulatedPayoutService {
  constructor(private readonly database: DatabaseService) {}

  async simulate(
    paymentId: string,
    callerId: string,
    idempotencyKey: string,
    outcome: SimulatedOutcome,
  ): Promise<Prisma.JsonValue> {
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (
      typeof paymentId !== 'string' ||
      !uuidPattern.test(paymentId) ||
      typeof callerId !== 'string' ||
      !/^[\x21-\x7E]{1,100}$/.test(callerId) ||
      typeof idempotencyKey !== 'string' ||
      !/^[\x21-\x7E]{1,128}$/.test(idempotencyKey) ||
      (outcome !== 'SUCCEEDED' && outcome !== 'FAILED')
    ) {
      throw new Error('Invalid simulated payout input');
    }

    paymentId = paymentId.toLowerCase();

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const previous = await tx.simulatedPayoutRequest.findUnique({
              where: {
                callerId_idempotencyKey: {
                  callerId,
                  idempotencyKey,
                },
              },
            });

            if (previous) {
              if (
                previous.paymentId !== paymentId ||
                previous.outcome !== outcome
              ) {
                throw new Error('Simulated payout idempotency conflict');
              }

              return previous.response;
            }

            const payment = await tx.payment.findUnique({
              where: { id: paymentId },
              include: {
                releaseJournal: true,
                simulatedPayout: true,
              },
            });

            if (!payment) {
              throw new Error('Payment not found');
            }

            if (payment.simulatedPayout) {
              throw new Error('Simulated payout already completed');
            }

            const journal = payment.releaseJournal;

            if (
              !payment.releasedAt ||
              !payment.fundedAt ||
              !payment.approvedAt ||
              payment.holdActive ||
              !journal ||
              journal.paymentId !== payment.id ||
              journal.currency !== payment.currency ||
              journal.grossMinor !== payment.grossMinor
            ) {
              throw new Error('Payment is not eligible for simulated payout');
            }

            const changed = await tx.payment.updateMany({
              where: {
                id: paymentId,
                version: payment.version,
                releasedAt: { not: null },
                holdActive: false,
              },
              data: {
                version: { increment: 1 },
              },
            });

            if (changed.count !== 1) {
              throw new Error('Payment state changed before simulated payout');
            }

            const completedAt = new Date();

            const payout = await tx.simulatedPayout.create({
              data: {
                paymentId,
                releaseJournalId: journal.id,
                netMinor: journal.netMinor,
                currency: journal.currency,
                status: outcome,
                version: 1,
                completedAt,
              },
            });

            const response = {
              simulated: true,
              payoutId: payout.id,
              paymentId,
              releaseJournalId: journal.id,
              netMinor: journal.netMinor.toString(),
              currency: journal.currency,
              status: outcome,
              completedAt: completedAt.toISOString(),
            };

            await tx.simulatedPayoutRequest.create({
              data: {
                callerId,
                idempotencyKey,
                paymentId,
                outcome,
                response,
              },
            });

            await tx.outboxEvent.create({
              data: {
                eventType: `SIMULATED_PAYOUT_${outcome}`,
                schemaVersion: 1,
                producer: 'payment',
                aggregateId: paymentId,
                aggregateVersion: payment.version + 1,
                occurredAt: completedAt,
                correlationId: randomUUID(),
                data: response,
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

    throw new Error('Simulated payout could not be completed');
  }
}
