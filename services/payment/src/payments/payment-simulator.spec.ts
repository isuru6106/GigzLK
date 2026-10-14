import { PaymentSimulator } from './payment-simulator';

describe('PaymentSimulator', () => {
  let simulator: PaymentSimulator;

  beforeEach(() => {
    simulator = new PaymentSimulator();
  });

  it('releases a funded and approved payment', () => {
    simulator.create('payment-1', 1_000_000);
    simulator.fund('payment-1');
    simulator.approve('payment-1');

    const result = simulator.release('payment-1', 'release-key-1');

    expect(result.paymentId).toBe('payment-1');
    expect(result.lines.map((line) => line.amountMinor)).toEqual([
      1_000_000, 900_000, 100_000,
    ]);
    expect(simulator.get('payment-1').released).toBe(true);
  });

  it('rejects release before funding', () => {
    simulator.create('payment-1', 1_000_000);
    simulator.approve('payment-1');

    expect(() => simulator.release('payment-1', 'release-key-1')).toThrow(
      'Payment is not funded',
    );

    expect(simulator.get('payment-1').released).toBe(false);
  });

  it('rejects release before approval', () => {
    simulator.create('payment-1', 1_000_000);
    simulator.fund('payment-1');

    expect(() => simulator.release('payment-1', 'release-key-1')).toThrow(
      'Work is not approved',
    );
  });

  it('blocks release while a hold is active', () => {
    simulator.create('payment-1', 1_000_000);
    simulator.fund('payment-1');
    simulator.approve('payment-1');
    simulator.setHold('payment-1', true);

    expect(() => simulator.release('payment-1', 'release-key-1')).toThrow(
      'Payment has an active hold',
    );
  });

  it('returns the original result for a retry with the same key', () => {
    simulator.create('payment-1', 1_000_000);
    simulator.fund('payment-1');
    simulator.approve('payment-1');

    const first = simulator.release('payment-1', 'release-key-1');
    const retry = simulator.release('payment-1', 'release-key-1');

    expect(retry).toEqual(first);
  });

  it('rejects a second release with a different key', () => {
    simulator.create('payment-1', 1_000_000);
    simulator.fund('payment-1');
    simulator.approve('payment-1');
    simulator.release('payment-1', 'release-key-1');

    expect(() => simulator.release('payment-1', 'release-key-2')).toThrow(
      'Payment is already released',
    );
  });

  it('rejects duplicate payment IDs', () => {
    simulator.create('payment-1', 1_000_000);

    expect(() => simulator.create('payment-1', 2_000_000)).toThrow(
      'Payment already exists',
    );
  });

  it('rejects an unknown payment', () => {
    expect(() => simulator.get('missing')).toThrow('Payment not found');
  });
});
