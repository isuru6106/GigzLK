import { calculateCommission } from './commission';
import { assertReleaseEligible } from './release-eligibility';
import { createReleaseJournal } from './release-journal';
import type { JournalLine } from '../ledger/ledger';

interface SimulatedPayment {
  paymentId: string;
  grossMinor: number;
  funded: boolean;
  approved: boolean;
  holdActive: boolean;
  released: boolean;
}

interface ReleaseResult {
  paymentId: string;
  lines: JournalLine[];
}

export class PaymentSimulator {
  private readonly payments = new Map<string, SimulatedPayment>();
  private readonly releases = new Map<string, ReleaseResult>();

  create(paymentId: string, grossMinor: number): void {
    this.requireId(paymentId);

    if (this.payments.has(paymentId)) {
      throw new Error('Payment already exists');
    }

    calculateCommission(grossMinor);

    this.payments.set(paymentId, {
      paymentId,
      grossMinor,
      funded: false,
      approved: false,
      holdActive: false,
      released: false,
    });
  }

  get(paymentId: string): SimulatedPayment {
    return { ...this.findPayment(paymentId) };
  }

  fund(paymentId: string): void {
    this.findPayment(paymentId).funded = true;
  }

  approve(paymentId: string): void {
    this.findPayment(paymentId).approved = true;
  }

  setHold(paymentId: string, active: boolean): void {
    if (typeof active !== 'boolean') {
      throw new Error('Hold state must be a boolean');
    }

    const payment = this.findPayment(paymentId);

    if (payment.released) {
      throw new Error('Cannot change hold after release');
    }

    payment.holdActive = active;
  }

  release(paymentId: string, idempotencyKey: string): ReleaseResult {
    this.requireId(idempotencyKey);

    const previous = this.releases.get(idempotencyKey);

    if (previous) {
      if (previous.paymentId !== paymentId) {
        throw new Error('Idempotency key belongs to another payment');
      }

      return this.copyResult(previous);
    }

    const payment = this.findPayment(paymentId);
    assertReleaseEligible(payment);

    const result: ReleaseResult = {
      paymentId,
      lines: createReleaseJournal(payment.grossMinor),
    };

    payment.released = true;
    this.releases.set(idempotencyKey, result);

    return this.copyResult(result);
  }

  private findPayment(paymentId: string): SimulatedPayment {
    this.requireId(paymentId);

    const payment = this.payments.get(paymentId);

    if (!payment) {
      throw new Error('Payment not found');
    }

    return payment;
  }

  private requireId(value: string): void {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('ID or idempotency key must not be blank');
    }
  }

  private copyResult(result: ReleaseResult): ReleaseResult {
    return {
      paymentId: result.paymentId,
      lines: result.lines.map((line) => ({ ...line })),
    };
  }
}
