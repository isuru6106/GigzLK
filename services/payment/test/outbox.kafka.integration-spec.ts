import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { expect, it } from '@jest/globals';
import { Kafka, logLevel } from 'kafkajs';
import { DatabaseService } from '../src/database.service';
import { KafkaEventPublisher } from '../src/outbox/kafka-event.publisher';
import { OutboxRepository } from '../src/outbox/outbox.repository';
import { OutboxWorker } from '../src/outbox/outbox.worker';

it('publishes a stored outbox event to Kafka and records delivery', async () => {
  const connectionString = process.env.DATABASE_URL;

  if (
    !connectionString ||
    new URL(connectionString).pathname !== '/gigzlk_payment_test'
  ) {
    throw new Error('Kafka integration test requires gigzlk_payment_test');
  }

  const topic = 'gigzlk.payment.outbox-test.v1';
  const eventId = randomUUID();
  const aggregateId = randomUUID();

  const database = new DatabaseService();
  const kafka = new Kafka({
    clientId: 'payment-outbox-test',
    brokers: ['127.0.0.1:9092'],
    connectionTimeout: 3_000,
    requestTimeout: 10_000,
    retry: { retries: 0 },
    logLevel: logLevel.INFO,
  });

  const producer = kafka.producer({
    allowAutoTopicCreation: false,
  });

  const consumer = kafka.consumer({
    groupId: `payment-outbox-test-${randomUUID()}`,
    allowAutoTopicCreation: false,
    sessionTimeout: 10_000,
    heartbeatInterval: 3_000,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let cleanupFailed = false;

  try {
    await database.$connect();

    if ((await database.outboxEvent.count()) !== 0) {
      throw new Error('Test outbox must be empty before this test starts');
    }

    await producer.connect();
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: true });

    let receive!: (message: {
      key: string | undefined;
      value: unknown;
    }) => void;

    const received = new Promise<{
      key: string | undefined;
      value: unknown;
    }>((resolve) => {
      receive = resolve;
    });

    await consumer.run({
      eachMessage: ({ message }) => {
        const text = message.value?.toString();

        if (!text) {
          return Promise.resolve();
        }

        const value: unknown = JSON.parse(text);

        if (
          typeof value === 'object' &&
          value !== null &&
          'eventId' in value &&
          value.eventId === eventId
        ) {
          receive({
            key: message.key?.toString(),
            value,
          });
        }

        return Promise.resolve();
      },
    });

    const event = await database.outboxEvent.create({
      data: {
        eventId,
        eventType: 'PAYMENT_RELEASED',
        schemaVersion: 1,
        producer: 'payment',
        aggregateId,
        aggregateVersion: 3,
        occurredAt: new Date(),
        correlationId: randomUUID(),
        data: {
          paymentId: aggregateId,
          currency: 'LKR',
          grossMinor: '1000000',
          commissionMinor: '100000',
          netMinor: '900000',
        },
      },
    });

    const worker = new OutboxWorker(
      new OutboxRepository(database),
      new KafkaEventPublisher(producer, topic),
    );

    expect(await worker.runOnce()).toBe('PUBLISHED');

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Timed out waiting for Kafka event')),
        20_000,
      );
    });

    const delivered = await Promise.race([received, timeout]);

    expect(delivered.key).toBe(aggregateId);
    expect(delivered.value).toEqual({
      eventId,
      eventType: event.eventType,
      schemaVersion: 1,
      producer: 'payment',
      aggregateId,
      aggregateVersion: 3,
      occurredAt: event.occurredAt.toISOString(),
      correlationId: event.correlationId,
      data: event.data,
    });

    const stored = await database.outboxEvent.findUniqueOrThrow({
      where: { eventId },
    });

    expect(stored.publishedAt).toBeInstanceOf(Date);
    expect(stored.attempts).toBe(1);
    expect(stored.claimId).toBeNull();
    expect(stored.claimExpiresAt).toBeNull();
    expect(stored.failedAt).toBeNull();

    expect(await worker.runOnce()).toBe('IDLE');
  } finally {
    if (timer) {
      clearTimeout(timer);
    }

    const results = await Promise.allSettled([
      consumer.disconnect(),
      producer.disconnect(),
      database.outboxEvent.deleteMany({ where: { eventId } }),
    ]);

    const disconnect = await Promise.allSettled([database.$disconnect()]);

    cleanupFailed = [...results, ...disconnect].some(
      (result) => result.status === 'rejected',
    );

    if (cleanupFailed) {
      console.error('Kafka integration test cleanup failed');
    }
  }

  if (cleanupFailed) {
    throw new Error('Kafka integration test cleanup failed');
  }
}, 60_000);
