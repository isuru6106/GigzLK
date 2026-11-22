const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { Client } = require('pg');
const { DatabaseService } = require('../dist/database.service.js');
const {
  MarketplaceSessionService,
} = require('../dist/sessions/marketplace-session.service.js');

const database = new DatabaseService();
const service = new MarketplaceSessionService(database);

const accountId = randomUUID();
const email = `session-check-${accountId}@example.invalid`;
const lifetimeMs = 7 * 24 * 60 * 60 * 1000;
let credentialVersion = 1;

async function expectRejected(authenticatedAt, version = credentialVersion) {
  await assert.rejects(
    () => service.createForAccount(accountId, authenticatedAt, version),
    (error) => {
      assert.equal(error.getStatus(), 401);
      assert.equal(error.getResponse().code, 'INVALID_CREDENTIALS');
      return true;
    },
  );
}

async function expectUnavailable(authenticatedAt) {
  await assert.rejects(
    () =>
      service.createForAccount(
        accountId,
        authenticatedAt,
        credentialVersion,
      ),
    (error) => {
      assert.equal(error.getStatus(), 503);
      assert.equal(error.getResponse().code, 'AUTH_UNAVAILABLE');
      return true;
    },
  );
}

async function sessionCount() {
  return database.client.authSession.count({
    where: { accountId },
  });
}

async function checkConcurrentPasswordChange(authenticatedAt) {
  const writer = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 2000,
    statement_timeout: 2000,
  });

  let connected = false;
  let transactionOpen = false;
  let pending;

  try {
    await writer.connect();
    connected = true;

    await writer.query('BEGIN');
    transactionOpen = true;

    // UPDATE holds the account row lock until commit.
    await writer.query(
      `UPDATE "Account"
       SET "passwordHash" = $1,
           "credentialVersion" = "credentialVersion" + 1
       WHERE "id" = $2::uuid`,
      ['TEST_ONLY_CHANGED_PASSWORD_HASH', accountId],
    );

    const pidResult = await writer.query('SELECT pg_backend_pid() AS pid');
    const writerPid = pidResult.rows[0].pid;
    const previousCount = await sessionCount();

    // Attach rejection handling immediately.
    pending = service
      .createForAccount(accountId, authenticatedAt, credentialVersion)
      .then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error }),
      );

    // Observe the actual database lock wait rather than assuming a delay
    // means the session operation reached SELECT ... FOR UPDATE.
    const waitDeadline = Date.now() + 1500;
    let observedWait = false;

    while (Date.now() < waitDeadline) {
      const rows = await database.client.$queryRaw`
        SELECT EXISTS (
          SELECT 1
          FROM pg_stat_activity
          WHERE ${writerPid}::integer = ANY(pg_blocking_pids(pid))
        ) AS waiting
      `;

      if (rows[0].waiting) {
        observedWait = true;
        break;
      }

      await delay(10);
    }

    assert.equal(
      observedWait,
      true,
      'Session creation did not reach the expected account lock wait.',
    );

    await writer.query('COMMIT');
    transactionOpen = false;
    credentialVersion += 1;

    const outcome = await pending;

    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.getStatus(), 401);
    assert.equal(
      outcome.error.getResponse().code,
      'INVALID_CREDENTIALS',
    );
    assert.equal(await sessionCount(), previousCount);

    const account = await database.client.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { credentialVersion: true },
    });

    assert.equal(account.credentialVersion, credentialVersion);

    console.log(
      'PASS: session creation waits for a concurrent password update and rejects the stale version.',
    );
  } finally {
    try {
      if (transactionOpen) {
        await writer.query('ROLLBACK');
      }
    } finally {
      try {
        if (pending) {
          await pending;
        }
      } finally {
        if (connected) {
          await writer.end();
        }
      }
    }
  }
}

async function main() {
  try {
    const account = await database.client.account.create({
      data: {
        id: accountId,
        email,
        emailNormalized: email,
        // Synthetic fixture; never used for password authentication.
        passwordHash: 'TEST_ONLY_NOT_A_PASSWORD_HASH',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
      select: { credentialVersion: true },
    });

    assert.equal(account.credentialVersion, 1);

    const authenticatedAt = new Date(Date.now() - 60_000);
    const before = Date.now();

    const result = await service.createForAccount(
      accountId,
      authenticatedAt,
      credentialVersion,
    );

    const after = Date.now();

    const stored = await database.client.authSession.findUniqueOrThrow({
      where: { id: result.sessionId },
    });

    assert.equal(result.audience, 'marketplace');
    assert.equal(stored.accountId, accountId);
    assert.equal(stored.audience, 'MARKETPLACE');
    assert.equal(stored.revokedAt, null);
    assert.ok(stored.authenticatedAt instanceof Date);

    assert.equal(
      stored.authenticatedAt.getTime(),
      authenticatedAt.getTime(),
    );
    assert.equal(
      stored.expiresAt.getTime(),
      authenticatedAt.getTime() + lifetimeMs,
    );
    assert.equal(
      result.sessionExpiresAt.getTime(),
      stored.expiresAt.getTime(),
    );
    assert.ok(stored.createdAt.getTime() >= before);
    assert.ok(stored.createdAt.getTime() <= after);
    assert.equal(await sessionCount(), 1);

    console.log(
      'PASS: default credential version and authentication deadline persisted correctly.',
    );

    await expectUnavailable(new Date(NaN));
    await expectUnavailable(new Date(Date.now() + 60_000));
    await expectUnavailable(new Date(Date.now() - lifetimeMs - 60_000));

    assert.equal(await sessionCount(), 1);

    console.log(
      'PASS: invalid, future and expired authentication times create no sessions.',
    );

    await checkConcurrentPasswordChange(authenticatedAt);

    // The now-stale version must remain rejected after the update committed.
    await expectRejected(authenticatedAt, credentialVersion - 1);
    assert.equal(await sessionCount(), 1);

    // A current version can create a session.
    await service.createForAccount(
      accountId,
      authenticatedAt,
      credentialVersion,
    );
    assert.equal(await sessionCount(), 2);

    console.log(
      'PASS: stale versions stay rejected and the current version is accepted.',
    );

    await database.client.account.update({
      where: { id: accountId },
      data: { status: 'DISABLED' },
    });

    await expectRejected(authenticatedAt);
    assert.equal(await sessionCount(), 2);

    console.log('PASS: disabled account cannot create another session.');

    await database.client.account.update({
      where: { id: accountId },
      data: {
        status: 'ACTIVE',
        emailVerifiedAt: null,
      },
    });

    await expectRejected(authenticatedAt);
    assert.equal(await sessionCount(), 2);

    console.log('PASS: unverified account cannot create another session.');
  } finally {
    try {
      // Only delete the fixture created by this run.
      await database.client.account.deleteMany({
        where: { id: accountId },
      });

      assert.equal(await sessionCount(), 0);

      console.log('PASS: temporary account and sessions removed.');
    } finally {
      await database.onModuleDestroy();
    }
  }
}

main().catch(() => {
  console.error('FAIL: session check or cleanup failed; details withheld.');
  process.exitCode = 1;
});