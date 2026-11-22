const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseService } = require('../dist/database.service.js');
const {
  AuthAdmissionCleanupService,
} = require('../dist/sessions/auth-admission-cleanup.service.js');
const {
  AuthAdmissionReconciliationService,
} = require('../dist/sessions/auth-admission-reconciliation.service.js');

const database = new DatabaseService();
const cleanup = new AuthAdmissionCleanupService(database);
const reconciliation = new AuthAdmissionReconciliationService(database);

const epoch = randomUUID();
const accountId = randomUUID();
const callerIssuer = `urn:gigzlk:test:maintenance:${randomUUID()}`;
const namespaceIds = [];

let ownsControl = false;
let fixtureTime;

async function createNamespace(closedAt) {
  const id = randomUUID();
  namespaceIds.push(id);

  const hour =
    BigInt(Math.floor(closedAt.getTime() / 3_600_000)) - 1n;

  await database.client.authAdmissionNamespace.create({
    data: {
      id,
      epoch,
      hour,
      openedAt: new Date(closedAt.getTime() - 3_600_000),
      closedAt,
    },
  });

  return id;
}

async function createReservation(namespaceId, pending = false) {
  return database.client.authAdmissionReservation.create({
    data: {
      namespaceId,
      attemptComponent: randomUUID(),
      callerIssuer,
      audience: 'MARKETPLACE',
      operation: '/internal/v1/auth/login',
      contextBinding: randomUUID(),
      authorizationHash:
        randomUUID().replaceAll('-', '') +
        randomUUID().replaceAll('-', ''),
      state: pending ? 'RESERVED' : 'CANCELLED',
      createdAt: fixtureTime,
      authorizationExpiresAt: new Date(
        fixtureTime.getTime() + 5 * 60_000,
      ),
      issuanceExpiresAt: new Date(
        fixtureTime.getTime() + 5 * 60_000,
      ),
      recoveryExpiresAt: new Date(
        fixtureTime.getTime() + 24 * 60 * 60_000,
      ),
      cancelledAt: pending ? null : fixtureTime,
      reconciliationPending: pending,
    },
  });
}

async function exists(id) {
  return (
    (await database.client.authAdmissionReservation.findUnique({
      where: { id },
    })) !== null
  );
}

// Wait for every operation before propagating failure.
// This prevents fixture cleanup racing an unfinished transaction.
async function runConcurrent(operations) {
  const results = await Promise.allSettled(
    operations.map((operation) =>
      Promise.resolve().then(operation),
    ),
  );

  const failed = results.find(
    (result) => result.status === 'rejected',
  );

  if (failed) {
    throw failed.reason;
  }

  return results.map((result) => result.value);
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

    const now = clocks[0].now;
    const hour = BigInt(Math.floor(now.getTime() / 3_600_000));
    fixtureTime = new Date(now.getTime() - 96 * 60 * 60_000);

    await database.client.authAdmissionControl.create({
      data: {
        id: 'admission',
        epoch,
        enabled: true,
        activeHour: hour,
        closedThroughHour: hour - 1n,
      },
    });
    ownsControl = true;

    await database.client.account.create({
      data: {
        id: accountId,
        email: `maintenance-${accountId}@example.invalid`,
        emailNormalized: `maintenance-${accountId}@example.invalid`,
        passwordHash: 'TEST_ONLY_NOT_A_PASSWORD_HASH',
        status: 'ACTIVE',
        emailVerifiedAt: fixtureTime,
      },
    });

    const oldNamespace = await createNamespace(
      new Date(now.getTime() - 72 * 60 * 60_000),
    );

    const recentNamespace = await createNamespace(
      new Date(now.getTime() - 47 * 60 * 60_000),
    );

    const eligible = await createReservation(oldNamespace);
    const unresolved = await createReservation(oldNamespace, true);
    const tooRecent = await createReservation(recentNamespace);
    const associated = await createReservation(oldNamespace);

    const attempt = await database.client.authLoginAttempt.create({
      data: {
        reservationId: associated.id,
        callerIssuer,
        audience: 'MARKETPLACE',
        contextBinding: associated.contextBinding,
        state: 'CANCELLED',
        admittedAt: fixtureTime,
        issuanceExpiresAt: associated.issuanceExpiresAt,
        recoveryExpiresAt: associated.recoveryExpiresAt,
        cancelledAt: fixtureTime,
      },
    });

    await database.client.authAdmissionReservation.update({
      where: { id: associated.id },
      data: { consumedAt: fixtureTime },
    });

    const associatedSession =
      await database.client.authSession.create({
        data: {
          accountId,
          audience: 'MARKETPLACE',
          loginAttemptId: attempt.id,
          authenticatedAt: fixtureTime,
          createdAt: fixtureTime,
          expiresAt: new Date(
            fixtureTime.getTime() + 7 * 24 * 60 * 60_000,
          ),
          revokedAt: fixtureTime,
        },
      });

    // Force failure after the callback, inside a real transaction.
    const failingDatabase = {
      client: {
        $transaction: (callback) =>
          database.client.$transaction(async (transaction) => {
            await callback(transaction);
            throw new Error('TEST_ONLY_FORCE_ROLLBACK');
          }),
      },
    };

    await assert.rejects(
      () =>
        new AuthAdmissionCleanupService(
          failingDatabase,
        ).runBatch(),
      (error) => error.getStatus() === 503,
    );

    assert.equal(await exists(eligible.id), true);

    console.log(
      'PASS: failed cleanup rolls back database deletions.',
    );

    const cleanupResults = await runConcurrent([
      () => cleanup.runBatch(),
      () => cleanup.runBatch(),
    ]);

    assert.equal(
      cleanupResults.reduce(
        (total, result) =>
          total + result.deletedReservations,
        0,
      ),
      1,
    );

    assert.equal(await exists(eligible.id), false);
    assert.equal(await exists(unresolved.id), true);
    assert.equal(await exists(tooRecent.id), true);
    assert.equal(await exists(associated.id), true);

    console.log(
      'PASS: concurrent cleanup deletes eligible metadata once and preserves protected records.',
    );

    const reconciliationResults = await runConcurrent([
      () => reconciliation.runBatch(),
      () => reconciliation.runBatch(),
    ]);

    assert.equal(
      reconciliationResults.reduce(
        (total, result) =>
          total + result.resolvedReservations,
        0,
      ),
      1,
    );

    const recovered =
      await database.client.authAdmissionReservation.findUniqueOrThrow({
        where: { id: unresolved.id },
      });

    assert.equal(recovered.state, 'CANCELLED');
    assert.equal(recovered.reconciliationPending, false);
    assert.ok(recovered.cancelledAt instanceof Date);

    assert.equal(
      (await reconciliation.runBatch()).resolvedReservations,
      0,
    );

    const repeated =
      await database.client.authAdmissionReservation.findUniqueOrThrow({
        where: { id: unresolved.id },
      });

    assert.equal(
      repeated.cancelledAt.getTime(),
      recovered.cancelledAt.getTime(),
    );

    console.log(
      'PASS: concurrent reconciliation resolves pending work once and preserves its cancellation timestamp.',
    );

    const afterRecovery = await cleanup.runBatch();

    assert.equal(afterRecovery.deletedReservations, 1);
    assert.equal(await exists(unresolved.id), false);
    assert.equal(await exists(tooRecent.id), true);
    assert.equal(await exists(associated.id), true);

    const preservedSession =
      await database.client.authSession.findUniqueOrThrow({
        where: { id: associatedSession.id },
      });

    assert.equal(
      preservedSession.loginAttemptId,
      attempt.id,
    );
    assert.equal(
      preservedSession.revokedAt.getTime(),
      fixtureTime.getTime(),
    );

    console.log(
      'PASS: resolved metadata becomes eligible without deleting associated sessions.',
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

        await database.client.authAdmissionNamespace.deleteMany({
          where: {
            id: { in: namespaceIds },
            epoch,
          },
        });

        await database.client.account.deleteMany({
          where: { id: accountId },
        });

        const removedControl =
          await database.client.authAdmissionControl.deleteMany({
            where: {
              id: 'admission',
              epoch,
            },
          });

        assert.equal(removedControl.count, 1);

        assert.equal(
          await database.client.authAdmissionReservation.count({
            where: { callerIssuer },
          }),
          0,
        );

        assert.equal(
          await database.client.authLoginAttempt.count({
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

        assert.equal(
          await database.client.account.count({
            where: { id: accountId },
          }),
          0,
        );

        assert.equal(
          await database.client.authAdmissionNamespace.count({
            where: {
              id: { in: namespaceIds },
              epoch,
            },
          }),
          0,
        );

        console.log(
          'PASS: temporary maintenance fixtures and control record removed.',
        );
      }
    } finally {
      await database.onModuleDestroy();
    }
  }
}

main().catch(() => {
  console.error(
    'FAIL: maintenance check or cleanup failed; details withheld.',
  );
  process.exitCode = 1;
});