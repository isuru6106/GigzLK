import { createReleaseJournal } from './release-journal';
import { validateJournal } from '../ledger/ledger';

describe('createReleaseJournal', () => {
  it('creates the correct journal for Rs. 10,000', () => {
    const lines = createReleaseJournal(1_000_000);

    expect(lines).toEqual([
      {
        account: 'PROTECTED_FUNDS',
        side: 'DEBIT',
        amountMinor: 1_000_000,
        currency: 'LKR',
      },
      {
        account: 'WORKER_PAYABLE',
        side: 'CREDIT',
        amountMinor: 900_000,
        currency: 'LKR',
      },
      {
        account: 'COMMISSION_REVENUE',
        side: 'CREDIT',
        amountMinor: 100_000,
        currency: 'LKR',
      },
    ]);

    expect(() => validateJournal(lines)).not.toThrow();
  });

  it('creates a balanced journal after commission rounding', () => {
    const lines = createReleaseJournal(15);

    expect(lines.map((line) => line.amountMinor)).toEqual([15, 13, 2]);
    expect(() => validateJournal(lines)).not.toThrow();
  });

  it('omits the commission line when rounded commission is zero', () => {
    const lines = createReleaseJournal(1);

    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.amountMinor)).toEqual([1, 1]);
    expect(() => validateJournal(lines)).not.toThrow();
  });

  it('rejects an invalid gross amount', () => {
    expect(() => createReleaseJournal(-100)).toThrow();
  });
});
