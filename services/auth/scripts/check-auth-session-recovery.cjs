const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { DatabaseService } = require('../dist/database.service.js');
const {
  AttemptSessionService,
} = require('../dist/sessions/attempt-session.service.js');
const {
  AuthSessionRecoveryService,
} = require('../dist/sessions/auth-session-recovery.service.js');

const database = new DatabaseService();
const writer = new AttemptSessionService(database);
const recovery = new AuthSessionRecoveryService(database);

const accountId = randomUUID();
const contextBinding = randomUUID();
const callerIssuer = `urn:gigzlk:test:recovery:${randomUUID()}`;
const attemptIds = [];

const authority = {
  callerIssuer,
  audience: 'MARKETPLACE',
  contextBinding,
};

function credentials() {
  return {
    accountId,
    authenticatedAt: new Date(),
    credentialVersion: 1,
  };
}

async function createAttempt() {
  const id = randomUUID();
  attemptIds.push(id);

  const now = Date.now();

  await database.client.authLoginAttempt.create({
    data: {
      id,
      callerIssuer,
      audience: 'MARKETPLACE',
      contextBinding,
      admittedAt: new Date(now),
      issuanceExpiresAt: new Date(now + 5 * 60_000),
      recoveryExpiresAt: new Date(now + 24 * 60 * 60_000),
    },
  });

  return id;
}

async function expectStatus(operation, status) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.getStatus(), status);
    return true;
  });
}

// Hold a real transaction after its service callback completes,
// before PostgreSQL receives COMMIT.
function heldDatabase() {
  let release;
  let signalReady;

  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const ready = new Promise((resolve) => {
    signalReady = resolve;
  });

  return {
    ready,
    release,
    database: {
      client: {
        $transaction: (callback) =>
          database.client.$transaction(async (transaction) => {
            const rows = await transaction.$queryRaw`
              SELECT pg_backend_pid() AS "pid"
            `;

            const result = await callback(transaction);

            signalReady(rows[0].pid);
            await gate;

            return result;
          }),
      },
    },
  };
}

// Observe actual database lock contention rather than assuming that
// an unsettled JavaScript promise proves a PostgreSQL lock wait.
async function waitForBlockedTransaction(blockerPid) {
  const deadline = Date.now() + 1000;

  while (Date.now() < deadline) {
    const rows = await database.client.$queryRaw`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE ${blockerPid}::integer = ANY(pg_blocking_pids(pid))
      ) AS "blocked"
    `;

    if (rows[0].blocked) {
      return;
    }

    await delay(20);
  }

  throw new Error('Expected PostgreSQL lock contention was not observed.');
}

async function race(firstOperation, secondOperation) {
  const held = heldDatabase();
  const first = firstOperation(held.database);

  // Ensure failures are observed while waiting for the held transaction.
  const blockerPid = await Promise.race([
    held.ready,
    first.then(() => {
      throw new Error('Transaction completed before the test gate.');
    }),
  ]);

  const second = secondOperation();

  // Attach rejection handling immediately.
  const secondOutcome = second.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );

  try {
    await waitForBlockedTransaction(blockerPid);
  } finally {
    held.release();

    // Drain both operations even if lock observation fails.
    await Promise.allSettled([first, secondOutcome]);
  }

  return {
    first: await first,
    second: await secondOutcome,
  };
}

async function main() {
  try {
    await database.client.account.create({
      data: {
        id: accountId,
        email: `recovery-${accountId}@example.invalid`,
        emailNormalized: `recovery-${accountId}@example.invalid`,
        passwordHash: 'TEST_ONLY_NOT_A_PASSWORD_HASH',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });

    // Cancellation holds the attempt lock before the writer starts.
    const cancelledFirst = await createAttempt();

    const cancellationRace = await race(
      (held) =>
        new AuthSessionRecoveryService(held).cancelAttempt(
          authority,
          cancelledFirst,
        ),
      () =>
        writer.createForAttempt(authority, cancelledFirst, credentials()),
    );

    assert.equal(cancellationRace.first.status, 'CANCELLED');
    assert.equal(cancellationRace.second.ok, false);
    assert.equal(cancellationRace.second.error.getStatus(), 409);

    assert.equal(
      await database.client.authSession.count({
        where: { loginAttemptId: cancelledFirst },
      }),
      0,
    );

    console.log('PASS: cancellation blocks and rejects late session creation.');

    // Writer holds the attempt lock before cancellation starts.
    const committedFirst = await createAttempt();

    const issuanceRace = await race(
      (held) =>
        new AttemptSessionService(held).createForAttempt(
          authority,
          committedFirst,
          credentials(),
        ),
      () => recovery.cancelAttempt(authority, committedFirst),
    );

    assert.equal(issuanceRace.second.ok, true);
    assert.equal(issuanceRace.second.value.status, 'CANCELLED');

    const revoked = await database.client.authSession.findUniqueOrThrow({
      where: { id: issuanceRace.first.sessionId },
    });

    assert.ok(revoked.revokedAt instanceof Date);

    const cancelled = await database.client.authLoginAttempt.findUniqueOrThrow({
      where: { id: committedFirst },
    });

    assert.equal(cancelled.state, 'CANCELLED');
    assert.ok(cancelled.cancelledAt instanceof Date);

    console.log('PASS: cancellation waits for commit and revokes its session.');

    // Competing writers serialize; only one may commit.
    const duplicateAttempt = await createAttempt();

    const duplicateRace = await race(
      (held) =>
        new AttemptSessionService(held).createForAttempt(
          authority,
          duplicateAttempt,
          credentials(),
        ),
      () =>
        writer.createForAttempt(authority, duplicateAttempt, credentials()),
    );

    assert.equal(duplicateRace.second.ok, false);
    assert.equal(duplicateRace.second.error.getStatus(), 409);

    assert.equal(
      await database.client.authSession.count({
        where: { loginAttemptId: duplicateAttempt },
      }),
      1,
    );

    console.log('PASS: competing writers create exactly one session.');

    // Wrong ownership cannot revoke the successful session.
    await expectStatus(
      () =>
        recovery.revokeSession(
          { ...authority, callerIssuer: 'urn:gigzlk:test:other-bff' },
          duplicateRace.first.sessionId,
        ),
      409,
    );

    const beforeRevocation =
      await database.client.authSession.findUniqueOrThrow({
        where: { id: duplicateRace.first.sessionId },
      });

    assert.equal(beforeRevocation.revokedAt, null);

    await recovery.revokeSession(authority, duplicateRace.first.sessionId);

    const firstRevocation =
      await database.client.authSession.findUniqueOrThrow({
        where: { id: duplicateRace.first.sessionId },
      });

    await recovery.revokeSession(authority, duplicateRace.first.sessionId);

    const repeatedRevocation =
      await database.client.authSession.findUniqueOrThrow({
        where: { id: duplicateRace.first.sessionId },
      });

    assert.equal(
      repeatedRevocation.revokedAt.getTime(),
      firstRevocation.revokedAt.getTime(),
    );

    await recovery.cancelAttempt(authority, committedFirst);

    const repeatedCancellation =
      await database.client.authLoginAttempt.findUniqueOrThrow({
        where: { id: committedFirst },
      });

    assert.equal(
      repeatedCancellation.cancelledAt.getTime(),
      cancelled.cancelledAt.getTime(),
    );

    console.log('PASS: ownership is enforced and repeated operations are stable.');

    // Force a real transaction failure after both writes.
    const rollbackAttempt = await createAttempt();

    const failingDatabase = {
      client: {
        $transaction: (callback) =>
          database.client.$transaction(async (transaction) => {
            await callback(transaction);
            throw new Error('TEST_ONLY_FORCE_ROLLBACK');
          }),
      },
    };

    await expectStatus(
      () =>
        new AttemptSessionService(failingDatabase).createForAttempt(
          authority,
          rollbackAttempt,
          credentials(),
        ),
      503,
    );

    assert.equal(
      await database.client.authSession.count({
        where: { loginAttemptId: rollbackAttempt },
      }),
      0,
    );

    const rolledBack =
      await database.client.authLoginAttempt.findUniqueOrThrow({
        where: { id: rollbackAttempt },
      });

    assert.equal(rolledBack.state, 'ADMITTED');

    await expectStatus(
      () => recovery.cancelAttempt(authority, randomUUID()),
      409,
    );

    console.log('PASS: transaction failure rolls back session and attempt writes.');
  } finally {
    try {
      // Delete only this script's fixtures, in foreign-key-safe order.
      await database.client.authSession.deleteMany({
        where: { accountId },
      });

      await database.client.authLoginAttempt.deleteMany({
        where: {
          id: { in: attemptIds },
          callerIssuer,
        },
      });

      await database.client.account.deleteMany({
        where: { id: accountId },
      });

      assert.equal(
        await database.client.authSession.count({ where: { accountId } }),
        0,
      );

      assert.equal(
        await database.client.authLoginAttempt.count({
          where: { callerIssuer },
        }),
        0,
      );

      console.log('PASS: temporary account, sessions and attempts removed.');
    } finally {
      await database.onModuleDestroy();
    }
  }
}

main().catch(() => {
  console.error('FAIL: recovery check or cleanup failed; details withheld.');
  process.exitCode = 1;
});