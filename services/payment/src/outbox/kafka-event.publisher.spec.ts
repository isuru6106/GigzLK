import { describe, expect, it, jest } from '@jest/globals';
import type { Producer } from 'kafkajs';
import type { OutboxEvent } from '../generated/prisma/client';
import { KafkaEventPublisher } from './kafka-event.publisher';

function createEvent(): OutboxEvent {
  return {
    eventId: '00000000-0000-4000-8000-000000000001',
    eventType: 'PAYMENT_RELEASED',
    schemaVersion: 1,
    producer: 'payment',
    aggregateId: '00000000-0000-4000-8000-000000000002',
    aggregateVersion: 3,
    occurredAt: new Date('2026-11-22T10:00:00.000Z'),
    correlationId: '00000000-0000-4000-8000-000000000003',
    causationId: null,
    data: {
      paymentId: '00000000-0000-4000-8000-000000000002',
      grossMinor: '1000000',
      commissionMinor: '100000',
      netMinor: '900000',
      currency: 'LKR',
    },
    createdAt: new Date('2026-11-22T10:00:00.000Z'),
    publishedAt: null,
    claimId: null,
    claimExpiresAt: null,
    failedAt: null,
    attempts: 0,
    nextAttemptAt: new Date('2026-11-22T10:00:00.000Z'),
  };
}

describe('KafkaEventPublisher', () => {
  it('publishes the shared envelope using the payment partition key', async () => {
    const send = jest.fn<Producer['send']>().mockResolvedValue([]);
    const publisher = new KafkaEventPublisher(
      { send },
      'gigzlk.payment.events.v1',
    );
    const event = createEvent();

    await publisher.publish(event);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      topic: 'gigzlk.payment.events.v1',
      acks: -1,
      timeout: 10_000,
      messages: [
        {
          key: event.aggregateId,
          value: JSON.stringify({
            eventId: event.eventId,
            eventType: event.eventType,
            schemaVersion: event.schemaVersion,
            producer: event.producer,
            aggregateId: event.aggregateId,
            aggregateVersion: event.aggregateVersion,
            occurredAt: event.occurredAt.toISOString(),
            correlationId: event.correlationId,
            data: event.data,
          }),
          headers: {
            eventId: event.eventId,
            eventType: event.eventType,
            schemaVersion: '1',
          },
        },
      ],
    });
  });

  it('includes causationId when present', async () => {
    const send = jest.fn<Producer['send']>().mockResolvedValue([]);
    const publisher = new KafkaEventPublisher(
      { send },
      'gigzlk.payment.events.v1',
    );
    const event = createEvent();
    event.causationId = '00000000-0000-4000-8000-000000000004';

    await publisher.publish(event);

    const value = send.mock.calls[0][0].messages[0].value;

    expect(typeof value).toBe('string');
    expect(JSON.parse(value as string) as unknown).toMatchObject({
      causationId: event.causationId,
    });
  });

  it('propagates a publishing failure and preserves the event on retry', async () => {
    const failure = new Error('Simulated Kafka failure');
    const send = jest
      .fn<Producer['send']>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce([]);

    const publisher = new KafkaEventPublisher(
      { send },
      'gigzlk.payment.events.v1',
    );
    const event = createEvent();

    await expect(publisher.publish(event)).rejects.toBe(failure);
    await publisher.publish(event);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
    expect(event.publishedAt).toBeNull();
    expect(event.attempts).toBe(0);
  });

  it.each(['', ' bad-topic', 'bad topic', '.', '..', 'a'.repeat(250)])(
    'rejects invalid topic %j',
    (topic) => {
      const send = jest.fn<Producer['send']>();

      expect(() => new KafkaEventPublisher({ send }, topic)).toThrow(
        'A valid Kafka topic is required',
      );

      expect(send).not.toHaveBeenCalled();
    },
  );
});
