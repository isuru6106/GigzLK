import { describe, expect, it } from '@jest/globals';
import type { Payment } from '../generated/prisma/client';
import { toPaymentResponse } from './payment-response';

function paymentFixture(): Payment {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    assignmentId: '00000000-0000-4000-8000-000000000002',
    grossMinor: 1_000_000n,
    currency: 'LKR',
    fundedAt: null,
    approvedAt: null,
    holdActive: false,
    releasedAt: null,
    version: 0,
    createdAt: new Date('2026-11-22T08:00:00.000Z'),
    updatedAt: new Date('2026-11-22T08:00:00.000Z'),
  };
}

describe('toPaymentResponse', () => {
  it('returns JSON-compatible amounts, timestamps and null values', () => {
    const response = toPaymentResponse(paymentFixture());

    expect(response).toEqual({
      paymentId: '00000000-0000-4000-8000-000000000001',
      assignmentId: '00000000-0000-4000-8000-000000000002',
      grossMinor: '1000000',
      currency: 'LKR',
      fundedAt: null,
      approvedAt: null,
      holdActive: false,
      releasedAt: null,
      version: 0,
      createdAt: '2026-11-22T08:00:00.000Z',
      updatedAt: '2026-11-22T08:00:00.000Z',
    });

    expect(() => JSON.stringify(response)).not.toThrow();
  });

  it('preserves large monetary values exactly', () => {
    const payment = paymentFixture();
    payment.grossMinor = 9_007_199_254_740_991n;

    expect(toPaymentResponse(payment).grossMinor).toBe('9007199254740991');
  });

  it('converts lifecycle dates into UTC strings', () => {
    const payment = paymentFixture();
    payment.fundedAt = new Date('2026-11-22T14:00:00+05:30');
    payment.approvedAt = new Date('2026-11-22T15:00:00+05:30');
    payment.releasedAt = new Date('2026-11-22T15:01:00+05:30');

    expect(toPaymentResponse(payment)).toMatchObject({
      fundedAt: '2026-11-22T08:30:00.000Z',
      approvedAt: '2026-11-22T09:30:00.000Z',
      releasedAt: '2026-11-22T09:31:00.000Z',
    });
  });

  it('excludes extra internal fields from the response', () => {
    const record = {
      ...paymentFixture(),
      callerId: 'internal-service',
      idempotencyKey: 'internal-key',
      releaseJournal: { internalOnly: true },
    };

    const response = toPaymentResponse(record);

    expect(response).not.toHaveProperty('callerId');
    expect(response).not.toHaveProperty('idempotencyKey');
    expect(response).not.toHaveProperty('releaseJournal');
  });
});
