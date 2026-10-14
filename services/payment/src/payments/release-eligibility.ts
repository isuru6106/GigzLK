export interface ReleaseEligibility {
  funded: boolean;
  approved: boolean;
  holdActive: boolean;
  released: boolean;
}

export function assertReleaseEligible(state: ReleaseEligibility): void {
  if (state.released !== false) {
    throw new Error('Payment is already released');
  }

  if (state.holdActive !== false) {
    throw new Error('Payment has an active hold');
  }

  if (state.funded !== true) {
    throw new Error('Payment is not funded');
  }

  if (state.approved !== true) {
    throw new Error('Work is not approved');
  }
}
