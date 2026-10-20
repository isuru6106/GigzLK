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

  private requireUuid(value: string): void {
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (typeof value !== 'string' || !uuidPattern.test(value)) {
      throw new Error('A valid UUID is required');
    }
  }
}
