import { calculateCommission } from './commission';

describe('calculateCommission', () => {
  it('splits Rs. 10,000 correctly', () => {
    expect(calculateCommission(1_000_000)).toEqual({
      grossMinor: 1_000_000,
      commissionMinor: 100_000,
      netMinor: 900_000,
      currency: 'LKR',
    });
  });

  it('rounds half a cent upward', () => {
    expect(calculateCommission(15)).toEqual({
      grossMinor: 15,
      commissionMinor: 2,
      netMinor: 13,
      currency: 'LKR',
    });
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid gross amount %s',
    (amount) => {
      expect(() => calculateCommission(amount)).toThrow();
    },
  );

  it('preserves the total at the maximum safe integer', () => {
    const result = calculateCommission(Number.MAX_SAFE_INTEGER);

    expect(result.commissionMinor).toBe(900_719_925_474_099);
    expect(result.commissionMinor + result.netMinor).toBe(result.grossMinor);
  });
});
