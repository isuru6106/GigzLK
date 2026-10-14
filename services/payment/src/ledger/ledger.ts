export interface JournalLine {
  account: string;
  side: 'DEBIT' | 'CREDIT';
  amountMinor: number;
  currency: 'LKR';
}

export function validateJournal(lines: readonly JournalLine[]): void {
  if (lines.length < 2) {
    throw new Error('A journal requires at least two lines');
  }

  let debits = 0n;
  let credits = 0n;

  for (const line of lines) {
    if (typeof line.account !== 'string' || !line.account.trim()) {
      throw new Error('Each line requires an account');
    }

    if (line.currency !== 'LKR') {
      throw new Error('Only LKR is supported');
    }

    if (!Number.isSafeInteger(line.amountMinor) || line.amountMinor <= 0) {
      throw new Error('Amount must be a positive safe integer');
    }

    const amount = BigInt(line.amountMinor);

    if (line.side === 'DEBIT') {
      debits += amount;
    } else if (line.side === 'CREDIT') {
      credits += amount;
    } else {
      throw new Error('Side must be DEBIT or CREDIT');
    }
  }

  if (debits !== credits) {
    throw new Error('Journal debits and credits must balance');
  }
}
