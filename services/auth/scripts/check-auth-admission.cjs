const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

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
  AuthAdmissionCancellationService,
} = require('../dist/sessions/auth-admission-cancellation.service.js');
const {
  AuthAdmissionVerificationService,
} = require('../dist/sessions/auth-admission-verification.service.js');
const {
  AuthAdmissionSessionService,
} = require('../dist/sessions/auth-admission-session.service.js');

const database = new DatabaseService();

const namespaces = new AuthAdmissionNamespaceService(database);
const reservations = new AuthAdmissionReservationService(database);
const consumption = new AuthAdmissionConsumptionService(database);
const cancellation = new AuthAdmissionCancellationService(database);
const verification = new AuthAdmissionVerificationService(database);
const sessions = new AuthAdmissionSessionService(database);

const epoch = randomUUID();
const accountId = randomUUID();
const callers = new Set();
let ownsControl = false;

function binding(namespaceId, callerIssuer) {
  const issuer = callerIssuer ?? `urn:gigzlk:test:admission:${randomUUID()}`;
  callers.add(issuer);

  return {
    callerIssuer: issuer,
    audience: 'MARKETPLACE',
    contextBinding: randomUUID(),
    namespaceId,
    attemptComponent: randomUUID(),
  };
}

async function expectStatus(operation, status) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.getStatus(), status);
    return true;
  });
}

function fulfilled(results) {
  return results.filter((result) => result.status === 'fulfilled');
}

function assertRejectedStatus(results, status) {
  for (const result of results) {
    if (result.status === 'rejected') {
      assert.equal(result.reason.getStatus(), status);
    }
  }
}

async function main() {
  try {
    const existing = await database.client.authAdmissionControl.findUnique({
      where: { id: 'admission' },
    });

    assert.equal(existing, null, 'An admission control record already exists.');

    const clocks = await database.client.$queryRaw`
      SELECT clock_timestamp() AS "now"
    `;
    const hour = BigInt(Math.floor(clocks[0].now.getTime() / 3_600_000));

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
        email: `admission-${accountId}@example.invalid`,
        emailNormalized: `admission-${accountId}@example.invalid`,
        passwordHash: 'TEST_ONLY_NOT_A_PASSWORD_HASH',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });

    const namespace = await namespaces.current();

    // Concurrent reservation requests for exactly the same identity.
    const firstBinding = binding(namespace.namespaceId);

    const reservedResults = await Promise.allSettled([
      reservations.reserve(firstBinding),
      reservations.reserve(firstBinding),
    ]);

    assert.equal(fulfilled(reservedResults).length, 1);
    assertRejectedStatus(reservedResults, 409);

    const reserved = fulfilled(reservedResults)[0].value;

    assert.equal(
      await database.client.authAdmissionReservation.count({
        where: {
          namespaceId: firstBinding.namespaceId,
          attemptComponent: firstBinding.attemptComponent,
        },
      }),
      1,
    );

    console.log('PASS: duplicate reservation requests create one authorization.');

    // Concurrent consumption: one owner receives a verification claim.
    const consumeInput = {
      ...firstBinding,
      authorization: reserved.authorization,
    };

    const consumedResults = await Promise.all([
      consumption.consume(consumeInput),
      consumption.consume(consumeInput),
    ]);

    assert.equal(
      consumedResults.filter((result) => result.status === 'ADMITTED').length,
      1,
    );
    assert.equal(
      consumedResults.filter((result) => result.status === 'EXISTING').length,
      1,
    );

    const admitted = consumedResults.find(
      (result) => result.status === 'ADMITTED',
    );
    const duplicate = consumedResults.find(
      (result) => result.status === 'EXISTING',
    );

    assert.equal('verificationClaim' in duplicate, false);

    const worker = {
      ...firstBinding,
      attemptId: admitted.attemptId,
      verificationClaim: admitted.verificationClaim,
    };

    const starts = await Promise.allSettled([
      verification.start(worker),
      verification.start(worker),
    ]);

    assert.equal(fulfilled(starts).length, 1);
    assertRejectedStatus(starts, 409);

    console.log('PASS: consumption and verification ownership are granted once.');

    const created = await sessions.create(worker, {
      accountId,
      authenticatedAt: new Date(),
      credentialVersion: 1,
    });

    await cancellation.cancel(firstBinding);

    const storedSession = await database.client.authSession.findUniqueOrThrow({
      where: { id: created.sessionId },
    });

    assert.ok(storedSession.revokedAt instanceof Date);

    await expectStatus(
      () =>
        sessions.create(worker, {
          accountId,
          authenticatedAt: new Date(),
          credentialVersion: 1,
        }),
      409,
    );

    console.log('PASS: cancellation revokes the associated session and fences reuse.');

    // Cancellation before consumption, including lost-authorization recovery.
    const earlyBinding = binding(namespace.namespaceId);
    const early = await reservations.reserve(earlyBinding);

    await cancellation.cancel(earlyBinding);
    await cancellation.cancel(earlyBinding);

    await expectStatus(
      () =>
        consumption.consume({
          ...earlyBinding,
          authorization: early.authorization,
        }),
      409,
    );

    console.log('PASS: reservation recovery works before an admitted attempt exists.');

    // Different attempt components cannot bypass the one-pending-context rule.
    const contextBinding = binding(namespace.namespaceId);

    const contextResults = await Promise.allSettled([
      reservations.reserve(contextBinding),
      reservations.reserve({
        ...contextBinding,
        attemptComponent: randomUUID(),
      }),
    ]);

    assert.equal(fulfilled(contextResults).length, 1);
    assertRejectedStatus(contextResults, 409);

    console.log('PASS: concurrent attempts cannot bypass the pending-context limit.');

    // Different contexts still share the caller's burst limit.
    const quotaCaller = `urn:gigzlk:test:admission:${randomUUID()}`;

    const quotaResults = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        reservations.reserve(binding(namespace.namespaceId, quotaCaller)),
      ),
    );

    assert.equal(fulfilled(quotaResults).length, 5);
    assertRejectedStatus(quotaResults, 429);

    console.log('PASS: caller burst quota is shared across concurrent contexts.');

    // A fresh epoch invalidates authorization and verification ownership.
    const oldBinding = binding(namespace.namespaceId);
    const oldAuthorization = await reservations.reserve(oldBinding);
    const oldAdmission = await consumption.consume({
      ...oldBinding,
      authorization: oldAuthorization.authorization,
    });

    assert.equal(oldAdmission.status, 'ADMITTED');

    const oldWorker = {
      ...oldBinding,
      attemptId: oldAdmission.attemptId,
      verificationClaim: oldAdmission.verificationClaim,
    };

    await verification.start(oldWorker);

    const replacementEpoch = randomUUID();

    await database.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id"
        FROM "AuthAdmissionControl"
        WHERE "id" = 'admission'
        FOR UPDATE
      `;

      await transaction.authAdmissionControl.update({
        where: { id: 'admission' },
        data: { epoch: replacementEpoch },
      });
    });

    await expectStatus(
      () =>
        consumption.consume({
          ...oldBinding,
          authorization: oldAuthorization.authorization,
        }),
      409,
    );

    await expectStatus(
      () =>
        sessions.create(oldWorker, {
          accountId,
          authenticatedAt: new Date(),
          credentialVersion: 1,
        }),
      409,
    );

    assert.equal(
      await database.client.authSession.count({
        where: { loginAttemptId: oldAdmission.attemptId },
      }),
      0,
    );

    console.log('PASS: an epoch change fences old authorization and issuance workers.');

    // Move the persisted hour ahead to simulate clock rollback.
    const currentControl =
      await database.client.authAdmissionControl.findUniqueOrThrow({
        where: { id: 'admission' },
      });

    await database.client.authAdmissionControl.update({
      where: { id: 'admission' },
      data: {
        activeHour: currentControl.activeHour + 1n,
        closedThroughHour: currentControl.activeHour,
      },
    });

    await expectStatus(() => namespaces.current(), 503);

    const afterRollback =
      await database.client.authAdmissionControl.findUniqueOrThrow({
        where: { id: 'admission' },
      });

    assert.equal(afterRollback.activeHour, currentControl.activeHour + 1n);
    assert.equal(
      afterRollback.closedThroughHour,
      currentControl.activeHour,
    );

    console.log('PASS: clock rollback cannot lower or reopen namespace boundaries.');
  } finally {
    try {
      if (ownsControl) {
        const callerList = [...callers];

        await database.client.authSession.deleteMany({
          where: { accountId },
        });

        await database.client.authLoginAttempt.deleteMany({
          where: { callerIssuer: { in: callerList } },
        });

        await database.client.authAdmissionReservation.deleteMany({
          where: { callerIssuer: { in: callerList } },
        });

        await database.client.authAdmissionCallerQuota.deleteMany({
          where: { callerIssuer: { in: callerList } },
        });

        await database.client.authAdmissionNamespace.deleteMany({
          where: { epoch },
        });

        await database.client.account.deleteMany({
          where: { id: accountId },
        });

        await database.client.authAdmissionControl.delete({
          where: { id: 'admission' },
        });

        assert.equal(
          await database.client.authAdmissionReservation.count({
            where: { callerIssuer: { in: callerList } },
          }),
          0,
        );

        console.log('PASS: temporary admission fixtures and control record removed.');
      }
    } finally {
      await database.onModuleDestroy();
    }
  }
}

main().catch(() => {
  console.error('FAIL: admission check or cleanup failed; details withheld.');
  process.exitCode = 1;
});