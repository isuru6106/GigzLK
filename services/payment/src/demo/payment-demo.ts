import 'dotenv/config';
import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { DatabaseService } from '../database.service';
import { PaymentRepository } from '../payments/payment.repository';
import { PaymentApprovalRepository } from '../payments/payment-approval.repository';
import { PaymentReleaseService } from '../payments/payment-release.service';
import { SimulatedPayoutService } from '../payments/simulated-payout.service';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const url = new URL(connectionString);

  if (
    url.pathname !== '/gigzlk_payment_test' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname)
  ) {
    throw new Error('Demo requires the local gigzlk_payment_test database');
  }

  const outcome = process.argv[2] ?? 'SUCCEEDED';

  if (outcome !== 'SUCCEEDED' && outcome !== 'FAILED') {
    throw new Error('Outcome must be SUCCEEDED or FAILED');
  }

  const schemaName = `payment_demo_${randomUUID().replaceAll('-', '')}`;
  url.searchParams.set('schema', schemaName);
  url.searchParams.set('options', `-c search_path=${schemaName}`);
  process.env.DATABASE_URL = url.toString();

  const database = new DatabaseService();
  let schemaCreated = false;
  let cleanupFailed = false;

  try {
    await database.$connect();

    // This identifier is generated locally, never supplied by a caller.
    await database.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
    schemaCreated = true;

    await promisify(execFile)(
      process.execPath,
      [
        resolve('node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
        '--config',
        './prisma7.config.ts',
      ],
      {
        env: { ...process.env },
        timeout: 60_000,
      },
    );

    const [location] = await database.$queryRaw<
      { active_schema: string | null }[]
    >`SELECT current_schema() AS active_schema`;

    assert.equal(location.active_schema, schemaName);

    console.info('LOCAL SIMULATION — no real money or live authorization');
    console.info('Using temporary synthetic records');

    const payments = new PaymentRepository(database);
    const approvals = new PaymentApprovalRepository(database);
    const releases = new PaymentReleaseService(database);
    const payouts = new SimulatedPayoutService(database);

    const payment = await payments.createForAssignment(randomUUID(), 1_000_000);

    console.info('1. Created payment: LKR 10,000.00');

    assert.equal(await payments.markFunded(payment.id), true);
    assert.equal(await payments.markFunded(payment.id), false);

    console.info('2. Simulated funding; duplicate confirmation made no change');

    const funded = await payments.findById(payment.id);
    assert.ok(funded);

    const callerId = randomUUID();
    const approvalKey = randomUUID();

    const approved = await approvals.approve(
      payment.id,
      callerId,
      approvalKey,
      funded.version,
    );

    assert.deepEqual(
      await approvals.approve(
        payment.id,
        callerId,
        approvalKey,
        funded.version,
      ),
      approved,
    );

    console.info('3. Recorded internal approval; identical retry verified');
    console.info('   Publisher and completion checks are NOT exercised here');

    const releaseKey = randomUUID();
    const journal = await releases.release(payment.id, callerId, releaseKey);

    assert.equal(journal.commissionMinor, 100_000n);
    assert.equal(journal.netMinor, 900_000n);

    const debits = journal.entries
      .filter((entry) => entry.side === 'DEBIT')
      .reduce((sum, entry) => sum + entry.amountMinor, 0n);

    const credits = journal.entries
      .filter((entry) => entry.side === 'CREDIT')
      .reduce((sum, entry) => sum + entry.amountMinor, 0n);

    assert.equal(debits, credits);

    assert.deepEqual(
      await releases.release(payment.id, callerId, releaseKey),
      journal,
    );

    console.info('4. Released: commission LKR 1,000; worker payable LKR 9,000');
    console.info('   Balanced journal and release retry verified');

    const payoutKey = randomUUID();
    const payout = await payouts.simulate(
      payment.id,
      callerId,
      payoutKey,
      outcome,
    );

    assert.deepEqual(
      await payouts.simulate(payment.id, callerId, payoutKey, outcome),
      payout,
    );

    console.info(`5. Simulated payout: ${outcome}; identical retry verified`);

    const events = await database.outboxEvent.findMany({
      where: { aggregateId: payment.id },
      orderBy: { aggregateVersion: 'asc' },
    });

    assert.deepEqual(
      events.map((event) => event.eventType),
      ['PAYMENT_RELEASED', `SIMULATED_PAYOUT_${outcome}`],
    );

    assert.ok(events.every((event) => event.publishedAt === null));

    console.info('6. Verified two durable outbox events; Kafka not invoked');
    console.info('Demo checks passed');
  } finally {
    try {
      if (schemaCreated) {
        await database.$executeRawUnsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      }
    } catch {
      cleanupFailed = true;
      console.error('Temporary demo schema cleanup failed');
    }

    try {
      await database.$disconnect();
    } catch {
      cleanupFailed = true;
      console.error('Demo database disconnect failed');
    }

    process.env.DATABASE_URL = connectionString;
  }

  if (cleanupFailed) {
    throw new Error('Demo cleanup failed');
  }

  console.info('Temporary demo schema removed');
}

void main().catch(() => {
  console.error('Payment demo failed; check local setup and migrations');
  process.exitCode = 1;
});
