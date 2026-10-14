import { PaymentSimulator } from './payment-simulator';

describe('PaymentSimulator safety', () => {
  let simulator: PaymentSimulator;

  beforeEach(() => {
    simulator = new PaymentSimulator();
    simulator.create('payment-1', 1_000_000);
    simulator.fund('payment-1');
    simulator.approve('payment-1');
  });

  it('rejects reuse of a release key for another payment', () => {
    simulator.release('payment-1', 'key-1');

    simulator.create('payment-2', 2_000_000);
    simulator.fund('payment-2');
    simulator.approve('payment-2');

    expect(() => simulator.release('payment-2', 'key-1')).toThrow(
      'Idempotency key belongs to another payment',
    );

    expect(simulator.get('payment-2').released).toBe(false);
  });

  it('protects stored payment state from caller changes', () => {
    const payment = simulator.get('payment-1');
    payment.grossMinor = 1;
    payment.released = true;

    expect(simulator.get('payment-1').grossMinor).toBe(1_000_000);
    expect(simulator.get('payment-1').released).toBe(false);
  });

  it('protects the saved release result from caller changes', () => {
    const result = simulator.release('payment-1', 'key-1');
    result.lines[0].amountMinor = 1;
    result.lines.pop();

    const retry = simulator.release('payment-1', 'key-1');

    expect(retry.lines.map((line) => line.amountMinor)).toEqual([
      1_000_000, 900_000, 100_000,
    ]);
  });

  it('allows retry after a hold is removed', () => {
    simulator.setHold('payment-1', true);

    expect(() => simulator.release('payment-1', 'key-1')).toThrow(
      'Payment has an active hold',
    );

    simulator.setHold('payment-1', false);

    expect(() => simulator.release('payment-1', 'key-1')).not.toThrow();
    expect(simulator.get('payment-1').released).toBe(true);
  });

  it('rejects changing a hold after release', () => {
    simulator.release('payment-1', 'key-1');

    expect(() => simulator.setHold('payment-1', true)).toThrow(
      'Cannot change hold after release',
    );
  });

  it('rejects a blank release key without releasing payment', () => {
    expect(() => simulator.release('payment-1', ' ')).toThrow(
      'ID or idempotency key must not be blank',
    );

    expect(simulator.get('payment-1').released).toBe(false);
  });
});
