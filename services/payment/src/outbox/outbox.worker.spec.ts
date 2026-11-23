import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { OutboxEvent } from '../generated/prisma/client';
import type { OutboxRepository } from './outbox.repository';
import type { KafkaEventPublisher } from './kafka-event.publisher';
import { OutboxWorker } from './outbox.worker';

describe('OutboxWorker', () => {
  const repository = {
    claimNext: jest.fn<OutboxRepository['claimNext']>(),
    markPublished: jest.fn<OutboxRepository['markPublished']>(),
    recordFailure: jest.fn<OutboxRepository['recordFailure']>(),
  };

  const publisher = {
    publish: jest.fn<KafkaEventPublisher['publish']>(),
  };

  let event: OutboxEvent;
  let worker: OutboxWorker;

  beforeEach(() => {
    jest.resetAllMocks();

    event = {
      eventId: '00000000-0000-4000-8000-000000000001',
      eventType: 'PAYMENT_RELEASED',
      schemaVersion: 1,
      producer: 'payment',
      aggregateId: '00000000-0000-4000-8000-000000000002',
      aggregateVersion: 3,
      occurredAt: new Date('2026-11-22T10:00:00Z'),
      correlationId: '00000000-0000-4000-8000-000000000003',
      causationId: null,
      data: { currency: 'LKR', netMinor: '900000' },
      createdAt: new Date('2026-11-22T10:00:00Z'),
      publishedAt: null,
      attempts: 1,
      nextAttemptAt: new Date('2026-11-22T10:00:00Z'),
      claimId: '00000000-0000-4000-8000-000000000004',
      claimExpiresAt: new Date('2026-11-22T10:01:00Z'),
      failedAt: null,
    };

    repository.claimNext.mockResolvedValue(event);
    repository.markPublished.mockResolvedValue(true);
    repository.recordFailure.mockResolvedValue(true);
    publisher.publish.mockResolvedValue(undefined);

    worker = new OutboxWorker(repository, publisher);
  });

  it('does nothing when no event is available', async () => {
    repository.claimNext.mockResolvedValue(null);

    expect(await worker.runOnce()).toBe('IDLE');
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(repository.markPublished).not.toHaveBeenCalled();
    expect(repository.recordFailure).not.toHaveBeenCalled();
  });

  it('records publication only after the publisher succeeds', async () => {
    let acknowledge!: () => void;

    publisher.publish.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
        }),
    );

    // Notify the test when publishing has actually started.
    let started!: () => void;
    const publishingStarted = new Promise<void>((resolve) => {
      started = resolve;
    });

    publisher.publish.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
          started();
        }),
    );

    const running = worker.runOnce();
    await publishingStarted;

    expect(repository.markPublished).not.toHaveBeenCalled();

    acknowledge();

    expect(await running).toBe('PUBLISHED');
    expect(repository.markPublished).toHaveBeenCalledWith(
      event.eventId,
      '00000000-0000-4000-8000-000000000004',
    );
    expect(repository.recordFailure).not.toHaveBeenCalled();
  });

  it('records a publishing failure without marking delivery', async () => {
    publisher.publish.mockRejectedValue(new Error('Kafka unavailable'));

    expect(await worker.runOnce()).toBe('PUBLISH_FAILED');
    expect(repository.recordFailure).toHaveBeenCalledWith(
      event.eventId,
      '00000000-0000-4000-8000-000000000004',
    );
    expect(repository.markPublished).not.toHaveBeenCalled();
  });

  it('reports a lost claim after successful publishing', async () => {
    repository.markPublished.mockResolvedValue(false);

    expect(await worker.runOnce()).toBe('CLAIM_LOST');
    expect(repository.recordFailure).not.toHaveBeenCalled();
  });

  it('reports a lost claim when failure cannot be recorded', async () => {
    publisher.publish.mockRejectedValue(new Error('Kafka unavailable'));
    repository.recordFailure.mockResolvedValue(false);

    expect(await worker.runOnce()).toBe('CLAIM_LOST');
    expect(repository.markPublished).not.toHaveBeenCalled();
  });

  it('propagates an uncertain database update after publishing', async () => {
    const failure = new Error('Database update unavailable');
    repository.markPublished.mockRejectedValue(failure);

    await expect(worker.runOnce()).rejects.toBe(failure);

    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(repository.recordFailure).not.toHaveBeenCalled();
  });

  it('propagates database failure while claiming', async () => {
    const failure = new Error('Database unavailable');
    repository.claimNext.mockRejectedValue(failure);

    await expect(worker.runOnce()).rejects.toBe(failure);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('propagates database failure while recording a publishing error', async () => {
    const failure = new Error('Database unavailable');
    publisher.publish.mockRejectedValue(new Error('Kafka unavailable'));
    repository.recordFailure.mockRejectedValue(failure);

    await expect(worker.runOnce()).rejects.toBe(failure);
    expect(repository.markPublished).not.toHaveBeenCalled();
  });

  it('refuses to publish an event without a claim ID', async () => {
    event.claimId = null;

    await expect(worker.runOnce()).rejects.toThrow(
      'Claimed event is missing its claim ID',
    );

    expect(publisher.publish).not.toHaveBeenCalled();
    expect(repository.markPublished).not.toHaveBeenCalled();
  });
});
