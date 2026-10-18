import { calculateCommission } from './commission';
import { validateJournal } from '../ledger/ledger';
import type { JournalLine } from '../ledger/ledger';

export function createReleaseJournal(grossMinor: number): JournalLine[] {
  const amounts = calculateCommission(grossMinor);

  const lines: JournalLine[] = [
    {
      account: 'PROTECTED_FUNDS',
      side: 'DEBIT',
      amountMinor: amounts.grossMinor,
      currency: amounts.currency,
    },
    {
      account: 'WORKER_PAYABLE',
      side: 'CREDIT',
      amountMinor: amounts.netMinor,
      currency: amounts.currency,
    },
  ];

  if (amounts.commissionMinor > 0) {
    lines.push({
      account: 'COMMISSION_REVENUE',
      side: 'CREDIT',
      amountMinor: amounts.commissionMinor,
      currency: amounts.currency,
    });
  }

  validateJournal(lines);

  return lines;
}
