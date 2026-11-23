import { describe, expect, it } from '@jest/globals';
import { readOutboxConfig } from './outbox.config';

describe('readOutboxConfig', () => {
  function validEnv(): NodeJS.ProcessEnv {
    return {
      OUTBOX_ENABLED: 'true',
      KAFKA_BROKERS: '127.0.0.1:9092',
      KAFKA_PAYMENT_TOPIC: 'gigzlk.payment.outbox-test.v1',
    };
  }

  it('reads valid configuration with the default polling interval', () => {
    expect(readOutboxConfig(validEnv())).toEqual({
      brokers: ['127.0.0.1:9092'],
      topic: 'gigzlk.payment.outbox-test.v1',
      pollIntervalMs: 1000,
    });
  });

  it('requires explicit enablement', () => {
    expect(() =>
      readOutboxConfig({ ...validEnv(), OUTBOX_ENABLED: 'false' }),
    ).toThrow('OUTBOX_ENABLED');
  });

  it('rejects missing brokers', () => {
    expect(() =>
      readOutboxConfig({ ...validEnv(), KAFKA_BROKERS: '' }),
    ).toThrow('KAFKA_BROKERS');
  });

  it.each([
    'localhost',
    'localhost:0',
    'localhost:65536',
    'http://localhost:9092',
  ])('rejects invalid broker %s', (broker) => {
    expect(() =>
      readOutboxConfig({ ...validEnv(), KAFKA_BROKERS: broker }),
    ).toThrow('hostname:port');
  });

  it.each(['', '.', '..', 'bad topic', 'a'.repeat(250)])(
    'rejects invalid topic %j',
    (topic) => {
      expect(() =>
        readOutboxConfig({ ...validEnv(), KAFKA_PAYMENT_TOPIC: topic }),
      ).toThrow('valid topic');
    },
  );

  it.each(['0', '99', '30001', '1.5', 'invalid'])(
    'rejects invalid polling interval %s',
    (interval) => {
      expect(() =>
        readOutboxConfig({
          ...validEnv(),
          OUTBOX_POLL_INTERVAL_MS: interval,
        }),
      ).toThrow('OUTBOX_POLL_INTERVAL_MS');
    },
  );

  it('accepts multiple brokers and a configured polling interval', () => {
    expect(
      readOutboxConfig({
        ...validEnv(),
        KAFKA_BROKERS: '127.0.0.1:9092, localhost:9094',
        OUTBOX_POLL_INTERVAL_MS: '2000',
      }),
    ).toMatchObject({
      brokers: ['127.0.0.1:9092', 'localhost:9094'],
      pollIntervalMs: 2000,
    });
  });
});
