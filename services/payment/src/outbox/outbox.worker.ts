import type { OutboxRepository } from './outbox.repository';
import type { KafkaEventPublisher } from './kafka-event.publisher';

export type OutboxRunResult =
  'IDLE' | 'PUBLISHED' | 'PUBLISH_FAILED' | 'CLAIM_LOST';

export class OutboxWorker {
  constructor(
    private readonly repository: Pick<
      OutboxRepository,
      'claimNext' | 'markPublished' | 'recordFailure'
    >,
    private readonly publisher: Pick<KafkaEventPublisher, 'publish'>,
  ) {}

  async runOnce(): Promise<OutboxRunResult> {
    const event = await this.repository.claimNext();

    if (!event) {
      return 'IDLE';
    }

    if (!event.claimId) {
      throw new Error('Claimed event is missing its claim ID');
    }

    try {
      await this.publisher.publish(event);
    } catch {
      const recorded = await this.repository.recordFailure(
        event.eventId,
        event.claimId,
      );

      return recorded ? 'PUBLISH_FAILED' : 'CLAIM_LOST';
    }

    // Keep this outside the publishing catch block:
    // Kafka may already have accepted the event.
    const recorded = await this.repository.markPublished(
      event.eventId,
      event.claimId,
    );

    return recorded ? 'PUBLISHED' : 'CLAIM_LOST';
  }
}
