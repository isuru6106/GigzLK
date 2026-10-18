import { validateJournal } from './ledger';

describe('validateJournal', () => {
  it('accepts a balanced commission release', () => {
    expect(() =>
      validateJournal([
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
      ]),
    ).not.toThrow();
  });

  it('rejects an unbalanced journal', () => {
    expect(() =>
      validateJournal([
        {
          account: 'PROTECTED_FUNDS',
          side: 'DEBIT',
          amountMinor: 1_000,
          currency: 'LKR',
        },
        {
          account: 'WORKER_PAYABLE',
          side: 'CREDIT',
          amountMinor: 900,
          currency: 'LKR',
        },
      ]),
    ).toThrow('Journal debits and credits must balance');
  });

  it('rejects an empty journal', () => {
    expect(() => validateJournal([])).toThrow(
      'A journal requires at least two lines',
    );
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid amount %s even when both sides match',
    (amountMinor) => {
      expect(() =>
        validateJournal([
          {
            account: 'PROTECTED_FUNDS',
            side: 'DEBIT',
            amountMinor,
            currency: 'LKR',
          },
          {
            account: 'WORKER_PAYABLE',
            side: 'CREDIT',
            amountMinor,
            currency: 'LKR',
          },
        ]),
      ).toThrow('Amount must be a positive safe integer');
    },
  );

  it('rejects a blank account', () => {
    expect(() =>
      validateJournal([
        {
          account: ' ',
          side: 'DEBIT',
          amountMinor: 100,
          currency: 'LKR',
        },
        {
          account: 'WORKER_PAYABLE',
          side: 'CREDIT',
          amountMinor: 100,
          currency: 'LKR',
        },
      ]),
    ).toThrow('Each line requires an account');
  });

  it('rejects unsupported currency at runtime', () => {
    expect(() =>
      validateJournal([
        {
          account: 'PROTECTED_FUNDS',
          side: 'DEBIT',
          amountMinor: 100,
          // @ts-expect-error Deliberately test invalid runtime input.
          currency: 'USD',
        },
        {
          account: 'WORKER_PAYABLE',
          side: 'CREDIT',
          amountMinor: 100,
          currency: 'LKR',
        },
      ]),
    ).toThrow('Only LKR is supported');
  });

  it('rejects an invalid accounting side at runtime', () => {
    expect(() =>
      validateJournal([
        {
          account: 'PROTECTED_FUNDS',
          // @ts-expect-error Deliberately test invalid runtime input.
          side: 'OTHER',
          amountMinor: 100,
          currency: 'LKR',
        },
        {
          account: 'WORKER_PAYABLE',
          side: 'CREDIT',
          amountMinor: 100,
          currency: 'LKR',
        },
      ]),
    ).toThrow('Side must be DEBIT or CREDIT');
  });
});
