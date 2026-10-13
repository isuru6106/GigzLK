export function calculateCommission(grossMinor: number) {
  if (!Number.isSafeInteger(grossMinor) || grossMinor <= 0) {
    throw new Error('Gross amount must be a positive safe integer');
  }

  const gross = BigInt(grossMinor);

  // 10% commission, rounded half-up to the nearest minor unit.
  const commission = (gross + 5n) / 10n;
  const net = gross - commission;

  return {
    grossMinor,
    commissionMinor: Number(commission),
    netMinor: Number(net),
    currency: 'LKR' as const,
  };
}
