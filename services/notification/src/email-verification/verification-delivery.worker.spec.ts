import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { VerificationDelivery } from './verification-delivery';
import { VerificationDeliveryRepository } from './verification-delivery.repository';
import { VerificationDeliveryWorker } from './verification-delivery.worker';
import { VerificationPayloadCrypto } from './verification-payload.crypto';

describe('VerificationDeliveryWorker', () => {
  const notificationId = 'abcdef00-0000-4000-8000-000000000001';
  const claimId = 'abcdef00-0000-4000-8000-000000000002';
  const callerId = 'auth-service';

  const encryption = new VerificationPayloadCrypto(
    'test-encryption',
    new Map([['test-encryption', Buffer.alloc(32, 1)]]),
  );

  const recipientEmail = 'synthetic@example.test';
  const verificationUrl =
    'https://marketplace.example.test/verify-email#synthetic-token';

  const repository = {
    recoverUnavailable:
      jest.fn<VerificationDeliveryRepository['recoverUnavailable']>(),
    deleteExpiredMetadata:
      jest.fn<VerificationDeliveryRepository['deleteExpiredMetadata']>(),
    claimNext: jest.fn<VerificationDeliveryRepository['claimNext']>(),
    recordResult: jest.fn<VerificationDeliveryRepository['recordResult']>(),
    canDispatch: jest.fn<VerificationDeliveryRepository['canDispatch']>(),
  };

  const delivery = {
    send: jest.fn<VerificationDelivery['send']>(),
  };

  function notification() {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60_000);
    const encrypted = encryption.encrypt(
      JSON.stringify({ recipientEmail, verificationUrl }),
      { notificationId, callerId },
    );
    return {
      id: notificationId,
      callerId,
      requestId: 'abcdef00-0000-4000-8000-000000000003',
      fingerprint: 'a'.repeat(64),
      fingerprintKeyId: 'test-fingerprint',
      templateId: 'email-verification-v1',
      status: 'SENDING' as const,
      deliveryOutcome: 'NOT_SENT' as const,
      expiresAt,
      sendBefore: new Date(expiresAt.getTime() - 120_000),
      metadataDeleteAfter: new Date(
        expiresAt.getTime() + 7 * 24 * 60 * 60 * 1_000,
      ),
      attempts: 1,
      nextAttemptAt: now,
      cancellationRequested: false,
      claimId,
      claimExpiresAt: new Date(now.getTime() + 60_000),
      providerReference: null,
      createdAt: now,
      updatedAt: now,
      payload: {
        notificationId,
        ...encrypted,
        ciphertext: Buffer.from(encrypted.ciphertext),
        nonce: Buffer.from(encrypted.nonce),
        authenticationTag: Buffer.from(encrypted.authenticationTag),
      },
    };
  }

  function worker() {
    return new VerificationDeliveryWorker(
      repository as unknown as VerificationDeliveryRepository,
      encryption,
      delivery,
    );
  }

  beforeEach(() => {
    jest.resetAllMocks();
    repository.canDispatch.mockResolvedValue(true);
    repository.recoverUnavailable.mockResolvedValue(0);
    repository.deleteExpiredMetadata.mockResolvedValue(0);
    repository.claimNext.mockResolvedValue(notification());
    repository.recordResult.mockResolvedValue(true);
    delivery.send.mockResolvedValue({
      outcome: 'ACCEPTED',
      providerReference: 'local-simulation:test',
    });
  });

  it('does nothing when no notification is available', async () => {
    repository.claimNext.mockResolvedValue(null);

    expect(await worker().runOnce()).toBe('IDLE');
    expect(delivery.send).not.toHaveBeenCalled();
    expect(repository.recordResult).not.toHaveBeenCalled();
  });

  it('decrypts the payload and records successful delivery', async () => {
    expect(await worker().runOnce()).toBe('RECORDED');

    expect(delivery.send).toHaveBeenCalledWith({
      notificationId,
      recipientEmail,
      verificationUrl,
      expiresAt: expect.any(Date),
    });

    expect(repository.recordResult).toHaveBeenCalledWith(
      notificationId,
      claimId,
      {
        outcome: 'ACCEPTED',
        providerReference: 'local-simulation:test',
      },
    );
  });

  it('records definite retryable provider failures', async () => {
    delivery.send.mockResolvedValue({
      outcome: 'NOT_SENT',
      retryable: true,
    });

    expect(await worker().runOnce()).toBe('RECORDED');

    expect(repository.recordResult).toHaveBeenCalledWith(
      notificationId,
      claimId,
      { outcome: 'NOT_SENT', retryable: true },
    );
  });

  it('treats a thrown provider error as uncertain delivery', async () => {
    delivery.send.mockRejectedValue(new Error('Synthetic provider failure'));

    expect(await worker().runOnce()).toBe('RECORDED');

    expect(repository.recordResult).toHaveBeenCalledWith(
      notificationId,
      claimId,
      { outcome: 'MAY_HAVE_BEEN_SENT' },
    );
  });

  it('does not call the provider when decryption fails', async () => {
    const claimed = notification();
    claimed.payload.authenticationTag = Buffer.alloc(16);

    repository.claimNext.mockResolvedValue(claimed);

    expect(await worker().runOnce()).toBe('RECORDED');
    expect(delivery.send).not.toHaveBeenCalled();
    expect(repository.recordResult).toHaveBeenCalledWith(
      notificationId,
      claimId,
      { outcome: 'NOT_SENT', retryable: true },
    );
  });

  it('does not send after the delivery cutoff', async () => {
    repository.claimNext.mockResolvedValue({
      ...notification(),
      sendBefore: new Date(Date.now() - 1_000),
    });

    expect(await worker().runOnce()).toBe('RECORDED');
    expect(delivery.send).not.toHaveBeenCalled();
    expect(repository.recordResult).toHaveBeenCalledWith(
      notificationId,
      claimId,
      { outcome: 'NOT_SENT', retryable: false },
    );
  });

  it('does not send using an expired claim', async () => {
    repository.claimNext.mockResolvedValue({
      ...notification(),
      claimExpiresAt: new Date(Date.now() - 1_000),
    });

    expect(await worker().runOnce()).toBe('CLAIM_LOST');
    expect(delivery.send).not.toHaveBeenCalled();
    expect(repository.recordResult).not.toHaveBeenCalled();
  });

  it('reports loss of claim ownership after delivery', async () => {
    repository.recordResult.mockResolvedValue(false);

    expect(await worker().runOnce()).toBe('CLAIM_LOST');
    expect(delivery.send).toHaveBeenCalledTimes(1);
  });

  it('propagates a database failure after sending without recording again', async () => {
    repository.recordResult.mockRejectedValue(
      new Error('Synthetic database failure'),
    );

    await expect(worker().runOnce()).rejects.toThrow(
      'Synthetic database failure',
    );

    expect(delivery.send).toHaveBeenCalledTimes(1);
    expect(repository.recordResult).toHaveBeenCalledTimes(1);
  });

  it('propagates recovery failure without sending', async () => {
    repository.recoverUnavailable.mockRejectedValue(
      new Error('Synthetic recovery failure'),
    );

    await expect(worker().runOnce()).rejects.toThrow(
      'Synthetic recovery failure',
    );

    expect(repository.claimNext).not.toHaveBeenCalled();
    expect(delivery.send).not.toHaveBeenCalled();
  });
  it('runs retention cleanup before claiming another notification', async () => {
    const order: string[] = [];

    repository.recoverUnavailable.mockImplementation(() => {
      order.push('recover');
      return Promise.resolve(0);
    });

    repository.deleteExpiredMetadata.mockImplementation(() => {
      order.push('cleanup');
      return Promise.resolve(0);
    });

    repository.claimNext.mockImplementation(() => {
      order.push('claim');
      return Promise.resolve(null);
    });

    expect(await worker().runOnce()).toBe('IDLE');
    expect(order).toEqual(['recover', 'cleanup', 'claim']);
  });

  it('propagates retention cleanup failure without sending', async () => {
    repository.deleteExpiredMetadata.mockRejectedValue(
      new Error('Synthetic cleanup failure'),
    );

    await expect(worker().runOnce()).rejects.toThrow(
      'Synthetic cleanup failure',
    );

    expect(repository.claimNext).not.toHaveBeenCalled();
    expect(delivery.send).not.toHaveBeenCalled();
  });
  it('does not send when the database dispatch check denies it', async () => {
    repository.canDispatch.mockResolvedValue(false);

    expect(await worker().runOnce()).toBe('RECORDED');

    expect(repository.canDispatch).toHaveBeenCalledWith(
      notificationId,
      claimId,
    );
    expect(delivery.send).not.toHaveBeenCalled();
    expect(repository.recordResult).toHaveBeenCalledWith(
      notificationId,
      claimId,
      { outcome: 'NOT_SENT', retryable: false },
    );
  });

  it('does not send when the database dispatch check fails', async () => {
    repository.canDispatch.mockRejectedValue(
      new Error('Synthetic dispatch check failure'),
    );

    await expect(worker().runOnce()).rejects.toThrow(
      'Synthetic dispatch check failure',
    );

    expect(delivery.send).not.toHaveBeenCalled();
    expect(repository.recordResult).not.toHaveBeenCalled();
  });
});
