import 'dotenv/config';
import { setTimeout as delay } from 'node:timers/promises';
import { Kafka, logLevel, Partitioners } from 'kafkajs';
import { DatabaseService } from '../database.service';
import { KafkaEventPublisher } from './kafka-event.publisher';
import { OutboxRepository } from './outbox.repository';
import { OutboxWorker } from './outbox.worker';
import { readOutboxConfig } from './outbox.config';

async function main(): Promise<void> {
  const config = readOutboxConfig();

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  // This initial runner is restricted to local development.
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('The local outbox runner requires NODE_ENV=development');
  }

  if (
    config.brokers.some(
      (broker) =>
        !broker.startsWith('127.0.0.1:') && !broker.startsWith('localhost:'),
    )
  ) {
    throw new Error('The local outbox runner requires loopback Kafka brokers');
  }

  const database = new DatabaseService();
  const kafka = new Kafka({
    clientId: 'gigzlk-payment-outbox',
    brokers: config.brokers,
    connectionTimeout: 3_000,
    requestTimeout: 10_000,
    retry: { retries: 0 },
    logLevel: logLevel.NOTHING,
  });

  const producer = kafka.producer({
    allowAutoTopicCreation: false,
    createPartitioner: Partitioners.DefaultPartitioner,
  });

  const abort = new AbortController();
  let stopping = false;

  const stop = () => {
    stopping = true;
    abort.abort();
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    await database.$connect();
    await producer.connect();

    const worker = new OutboxWorker(
      new OutboxRepository(database),
      new KafkaEventPublisher(producer, config.topic),
    );

    console.info('Payment outbox worker started');

    while (!stopping) {
      let pause = config.pollIntervalMs;

      try {
        const result = await worker.runOnce();

        if (result === 'PUBLISHED') {
          console.info('Outbox event published');
          pause = 0;
        } else if (result !== 'IDLE') {
          console.warn(`Outbox processing result: ${result}`);
        }
      } catch {
        // Do not print connection strings, payloads or raw exceptions.
        console.error('Outbox processing unavailable; retrying after delay');
        pause = Math.max(config.pollIntervalMs, 5_000);
      }

      if (pause > 0 && !stopping) {
        try {
          await delay(pause, undefined, { signal: abort.signal });
        } catch (error) {
          if (!abort.signal.aborted) {
            throw error;
          }
        }
      }
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);

    const cleanup = await Promise.allSettled([
      producer.disconnect(),
      database.$disconnect(),
    ]);

    if (cleanup.some((result) => result.status === 'rejected')) {
      throw new Error('Outbox worker cleanup failed');
    }

    console.info('Payment outbox worker stopped');
  }
}

void main().catch(() => {
  console.error('Payment outbox worker exited unsuccessfully');
  process.exitCode = 1;
});
