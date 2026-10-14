import {
  assertReleaseEligible,
  ReleaseEligibility,
} from './release-eligibility';

describe('assertReleaseEligible', () => {
  const eligible: ReleaseEligibility = {
    funded: true,
    approved: true,
    holdActive: false,
    released: false,
  };

  it('allows a funded, approved payment without a hold', () => {
    expect(() => assertReleaseEligible(eligible)).not.toThrow();
  });

  it('rejects an unfunded payment', () => {
    expect(() => assertReleaseEligible({ ...eligible, funded: false })).toThrow(
      'Payment is not funded',
    );
  });

  it('rejects work that has not been approved', () => {
    expect(() =>
      assertReleaseEligible({ ...eligible, approved: false }),
    ).toThrow('Work is not approved');
  });

  it('blocks release during a dispute hold', () => {
    expect(() =>
      assertReleaseEligible({ ...eligible, holdActive: true }),
    ).toThrow('Payment has an active hold');
  });

  it('rejects a payment that was already released', () => {
    expect(() =>
      assertReleaseEligible({ ...eligible, released: true }),
    ).toThrow('Payment is already released');
  });
});
