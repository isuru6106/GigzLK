import type { Producer } from 'kafkajs';
import type { OutboxEvent } from '../generated/prisma/client';

export class KafkaEventPublisher {
  constructor(
    private readonly producer: Pick<Producer, 'send'>,
    private readonly topic: string,
  ) {
    if (
      !topic ||
      topic !== topic.trim() ||
      !/^[a-zA-Z0-9._-]+$/.test(topic) ||
      topic.length > 249 ||
      topic === '.' ||
      topic === '..'
    ) {
      throw new Error('A valid Kafka topic is required');
    }
  }

  async publish(event: OutboxEvent): Promise<void> {
    const envelope = {
      eventId: event.eventId,
      eventType: event.eventType,
      schemaVersion: event.schemaVersion,
      producer: event.producer,
      aggregateId: event.aggregateId,
      aggregateVersion: event.aggregateVersion,
      occurredAt: event.occurredAt.toISOString(),
      correlationId: event.correlationId,
      ...(event.causationId === null ? {} : { causationId: event.causationId }),
      data: event.data,
    };

    await this.producer.send({
      topic: this.topic,
      acks: -1,
      timeout: 10_000,
      messages: [
        {
          key: event.aggregateId,
          value: JSON.stringify(envelope),
          headers: {
            eventId: event.eventId,
            eventType: event.eventType,
            schemaVersion: String(event.schemaVersion),
          },
        },
      ],
    });
  }
}
