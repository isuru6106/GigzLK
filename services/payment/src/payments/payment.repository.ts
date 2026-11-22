import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { calculateCommission } from './commission';

@Injectable()
export class PaymentRepository {
  constructor(private readonly database: DatabaseService) {}

  async createForAssignment(assignmentId: string, grossMinor: number) {
    this.requireUuid(assignmentId);

    // Reuse our existing positive, safe-integer amount validation.
    calculateCommission(grossMinor);

    return this.database.payment.create({
      data: {
        assignmentId,
        grossMinor: BigInt(grossMinor),
        currency: 'LKR',
      },
    });
  }

  async findById(paymentId: string) {
    this.requireUuid(paymentId);

    return this.database.payment.findUnique({
      where: { id: paymentId },
    });
  }

  async findByAssignmentId(assignmentId: string) {
    this.requireUuid(assignmentId);

    return this.database.payment.findUnique({
      where: { assignmentId },
    });
  }
  async markFunded(paymentId: string): Promise<boolean> {
    this.requireUuid(paymentId);

    const result = await this.database.payment.updateMany({
      where: {
        id: paymentId,
        fundedAt: null,
        releasedAt: null,
      },
      data: {
        fundedAt: new Date(),
        version: { increment: 1 },
      },
    });

    return result.count === 1;
  }

  async markApproved(paymentId: string): Promise<boolean> {
    this.requireUuid(paymentId);

    const result = await this.database.payment.updateMany({
      where: {
        id: paymentId,
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

    return result.count === 1;
  }

  async setHold(paymentId: string, active: boolean): Promise<boolean> {
    this.requireUuid(paymentId);

    if (typeof active !== 'boolean') {
      throw new Error('Hold state must be a boolean');
    }

    const result = await this.database.payment.updateMany({
      where: {
        id: paymentId,
        releasedAt: null,
        holdActive: !active,
      },
      data: {
        holdActive: active,
        version: { increment: 1 },
      },
    });

    return result.count === 1;
  }
  private requireUuid(value: string): void {
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (typeof value !== 'string' || !uuidPattern.test(value)) {
      throw new Error('A valid UUID is required');
    }
  }
}
