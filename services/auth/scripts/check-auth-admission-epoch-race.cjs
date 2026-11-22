const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

const { DatabaseService } = require('../dist/database.service.js');
const {
  AuthAdmissionNamespaceService,
} = require('../dist/sessions/auth-admission-namespace.service.js');
const {
  AuthAdmissionReservationService,
} = require('../dist/sessions/auth-admission-reservation.service.js');
const {
  AuthAdmissionConsumptionService,
} = require('../dist/sessions/auth-admission-consumption.service.js');
const {
  AuthAdmissionVerificationService,
} = require('../dist/sessions/auth-admission-verification.service.js');
const {
  AuthAdmissionSessionService,
} = require('../dist/sessions/auth-admission-session.service.js');

const database = new DatabaseService();
const epochs = [randomUUID(), randomUUID(), randomUUID()];
const accountId = randomUUID();
const callerIssuer = `urn:gigzlk:test:epoch-race:${randomUUID()}`;
let ownsControl = false;

async function prepareWorker() {
  const namespace = await new AuthAdmissionNamespaceService(database).current();

  const binding = {
    namespaceId: namespace.namespaceId,
    attemptComponent: randomUUID(),
    callerIssuer,
    audience: 'MARKETPLACE',
    contextBinding: randomUUID(),
  };

  const reservation =
    await new AuthAdmissionReservationService(database).reserve(binding);

  const admission =
    await new AuthAdmissionConsumptionService(database).consume({
      ...binding,
      authorization: reservation.authorization,
    });

  assert.equal(admission.status, 'ADMITTED');

  const worker = {
    ...binding,
    attemptId: admission.attemptId,
    verificationClaim: admission.verificationClaim,
  };

  await new AuthAdmissionVerificationService(database).start(worker);
  return worker;
}

function credentials() {
  return {
    accountId,
    authenticatedAt: new Date(),
    credentialVersion: 1,
  };
}

async function changeEpoch(client, epoch) {
  return client.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id"
      FROM "AuthAdmissionControl"
      WHERE "id" = 'admission'
      FOR UPDATE
    `;

    await transaction.authAdmissionControl.update({
      where: { id: 'admission' },
      data: { epoch },
    });
  });
}

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
    release,
    ready,
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

async function observeBlockedTransaction(blockerPid) {
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

  throw new Error('Expected database lock contention was not observed.');
}

async function race(firstOperation, secondOperation) {
  const held = heldDatabase();
  const first = Promise.resolve().then(
    () => firstOperation(held.database),
  );

  // Observe rejection immediately, including during lock observation.
  const firstOutcome = first.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );

  let secondOutcome;

  try {
    const blockerPid = await Promise.race([
      held.ready,
      firstOutcome.then((outcome) => {
        if (!outcome.ok) {
          throw outcome.error;
        }
        throw new Error('Transaction completed before the test gate.');
      }),
    ]);

    secondOutcome = Promise.resolve()
      .then(secondOperation)
      .then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error }),
      );

    await observeBlockedTransaction(blockerPid);
  } finally {
    held.release();
    await Promise.allSettled([
      firstOutcome,
      ...(secondOutcome ? [secondOutcome] : []),
    ]);
  }

  return {
    first: await firstOutcome,
    second: await secondOutcome,
  };
}

async function main() {
  try {
    assert.equal(
      await database.client.authAdmissionControl.findUnique({
        where: { id: 'admission' },
      }),
      null,
      'An admission control record already exists.',
    );

    const clocks = await database.client.$queryRaw`
      SELECT clock_timestamp() AS "now"
    `;
    const hour = BigInt(Math.floor(clocks[0].now.getTime() / 3_600_000));

    await database.client.authAdmissionControl.create({
      data: {
        id: 'admission',
        epoch: epochs[0],
        enabled: true,
        activeHour: hour,
        closedThroughHour: hour - 1n,
      },
    });
    ownsControl = true;

    await database.client.account.create({
      data: {
        id: accountId,
        email: `epoch-race-${accountId}@example.invalid`,
        emailNormalized: `epoch-race-${accountId}@example.invalid`,
        passwordHash: 'TEST_ONLY_NOT_A_PASSWORD_HASH',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });

    const oldWorker = await prepareWorker();

    // Epoch update holds the control lock before issuance starts.
    const epochFirst = await race(
      (held) => changeEpoch(held.client, epochs[1]),
      () =>
        new AuthAdmissionSessionService(database).create(
          oldWorker,
          credentials(),
        ),
    );

    assert.equal(epochFirst.first.ok, true);
    assert.equal(epochFirst.second.ok, false);
    assert.equal(epochFirst.second.error.getStatus(), 409);

    assert.equal(
      await database.client.authSession.count({
        where: { loginAttemptId: oldWorker.attemptId },
      }),
      0,
    );

    console.log(
      'PASS: issuance waits for epoch change and rejects the old worker.',
    );

    const currentWorker = await prepareWorker();

    // Issuance holds the control lock before the epoch update starts.
    const issuanceFirst = await race(
      (held) =>
        new AuthAdmissionSessionService(held).create(
          currentWorker,
          credentials(),
        ),
      () => changeEpoch(database.client, epochs[2]),
    );

    assert.equal(issuanceFirst.first.ok, true);
    assert.equal(issuanceFirst.second.ok, true);

    const session = await database.client.authSession.findUniqueOrThrow({
      where: { id: issuanceFirst.first.value.sessionId },
    });

    const control =
      await database.client.authAdmissionControl.findUniqueOrThrow({
        where: { id: 'admission' },
      });

    assert.equal(session.loginAttemptId, currentWorker.attemptId);
    assert.equal(control.epoch, epochs[2]);

    // Epoch fencing governs issuance, not already committed sessions.
    assert.equal(session.revokedAt, null);

    console.log(
      'PASS: epoch change waits for issuance; the pre-change session requires separate restore protection.',
    );
  } finally {
    try {
      if (ownsControl) {
        await database.client.authSession.deleteMany({
          where: { accountId },
        });
        await database.client.authLoginAttempt.deleteMany({
          where: { callerIssuer },
        });
        await database.client.authAdmissionReservation.deleteMany({
          where: { callerIssuer },
        });
        await database.client.authAdmissionCallerQuota.deleteMany({
          where: { callerIssuer },
        });
        await database.client.authAdmissionNamespace.deleteMany({
          where: { epoch: { in: epochs } },
        });
        await database.client.account.deleteMany({
          where: { id: accountId },
        });

        const removed =
          await database.client.authAdmissionControl.deleteMany({
            where: {
              id: 'admission',
              epoch: { in: epochs },
            },
          });

        assert.equal(removed.count, 1);

        assert.equal(
          await database.client.authAdmissionReservation.count({
            where: { callerIssuer },
          }),
          0,
        );
        assert.equal(
          await database.client.authSession.count({
            where: { accountId },
          }),
          0,
        );

        console.log('PASS: temporary epoch-race fixtures removed.');
      }
    } finally {
      await database.onModuleDestroy();
    }
  }
}

main().catch(() => {
  console.error('FAIL: epoch race check or cleanup failed; details withheld.');
  process.exitCode = 1;
});