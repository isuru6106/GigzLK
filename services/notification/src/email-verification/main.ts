import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseService } from '../database.service';
import { LocalVerificationDelivery } from './verification-delivery';
import { VerificationDeliveryRepository } from './verification-delivery.repository';
import { VerificationDeliveryWorker } from './verification-delivery.worker';
import { VerificationPayloadCrypto } from './verification-payload.crypto';

async function main(): Promise<void> {
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.NOTIFICATION_WORKER_ENABLED !== 'true'
  ) {
    throw new Error('Local notification worker requires explicit enablement');
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const databaseUrl = new URL(connectionString);

  if (
    !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
    !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) ||
    databaseUrl.pathname !== '/gigzlk_notification_test'
  ) {
    throw new Error(
      'Local worker requires the local notification test database',
    );
  }

  const keyId = process.env.NOTIFICATION_ENCRYPTION_KEY_ID;
  const encodedKey = process.env.NOTIFICATION_ENCRYPTION_KEY_BASE64;

  if (
    !keyId ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(keyId) ||
    !encodedKey ||
    !/^[A-Za-z0-9+/]{43}=$/.test(encodedKey)
  ) {
    throw new Error('Invalid notification encryption configuration');
  }

  const key = Buffer.from(encodedKey, 'base64');

  if (key.length !== 32 || key.toString('base64') !== encodedKey) {
    throw new Error('Invalid notification encryption configuration');
  }

  const encryption = new VerificationPayloadCrypto(
    keyId,
    new Map([[keyId, key]]),
  );

  const database = new DatabaseService();
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

    const worker = new VerificationDeliveryWorker(
      new VerificationDeliveryRepository(database),
      encryption,
      new LocalVerificationDelivery(),
    );

    console.info('Local notification simulation started; no email is sent');

    while (!stopping) {
      let pause = 1_000;

      try {
        const result = await worker.runOnce();

        if (result === 'RECORDED') {
          console.info('Simulated notification result recorded');
          pause = 0;
        } else if (result === 'CLAIM_LOST') {
          console.warn('Notification claim lost');
        }
      } catch {
        console.error(
          'Notification processing unavailable; retrying after delay',
        );
        pause = 5_000;
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

    await database.$disconnect();
  }

  console.info('Local notification simulation stopped');
}

void main().catch(() => {
  console.error('Local notification worker exited unsuccessfully');
  process.exitCode = 1;
});
