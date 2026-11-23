export interface OutboxConfig {
  brokers: string[];
  topic: string;
  pollIntervalMs: number;
}

export function readOutboxConfig(
  env: NodeJS.ProcessEnv = process.env,
): OutboxConfig {
  if (env.OUTBOX_ENABLED !== 'true') {
    throw new Error('Set OUTBOX_ENABLED=true to start the outbox worker');
  }

  const brokers = (env.KAFKA_BROKERS ?? '')
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);

  if (brokers.length === 0) {
    throw new Error('KAFKA_BROKERS is required');
  }

  for (const broker of brokers) {
    const match = /^([a-zA-Z0-9.-]+):([0-9]+)$/.exec(broker);
    const port = match ? Number(match[2]) : 0;

    if (!match || port < 1 || port > 65535) {
      throw new Error('Kafka brokers must use hostname:port format');
    }
  }

  const topic = env.KAFKA_PAYMENT_TOPIC ?? '';

  if (
    !/^[a-zA-Z0-9._-]+$/.test(topic) ||
    topic.length > 249 ||
    topic === '.' ||
    topic === '..'
  ) {
    throw new Error('KAFKA_PAYMENT_TOPIC must be a valid topic');
  }

  const pollIntervalMs = Number(env.OUTBOX_POLL_INTERVAL_MS ?? '1000');

  if (
    !Number.isInteger(pollIntervalMs) ||
    pollIntervalMs < 100 ||
    pollIntervalMs > 30_000
  ) {
    throw new Error('OUTBOX_POLL_INTERVAL_MS must be 100–30000');
  }

  return { brokers, topic, pollIntervalMs };
}
