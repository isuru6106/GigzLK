const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseService } = require('../dist/database.service.js');
const {
  MarketplaceSessionService,
} = require('../dist/sessions/marketplace-session.service.js');

const database = new DatabaseService();
const service = new MarketplaceSessionService(database);

const accountId = randomUUID();
const email = `session-check-${accountId}@example.invalid`;
const lifetimeMs = 7 * 24 * 60 * 60 * 1000;

async function expectRejected() {
  await assert.rejects(
    () => service.createForAccount(accountId),
    (error) => {
      assert.equal(error.getStatus(), 401);
      assert.equal(error.getResponse().code, 'INVALID_CREDENTIALS');
      return true;
    },
  );
}

async function main() {
  try {
    await database.client.account.create({
      data: {
        id: accountId,
        email,
        emailNormalized: email,
        // Synthetic fixture; never used for password authentication.
        passwordHash: 'TEST_ONLY_NOT_A_PASSWORD_HASH',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });

    const before = Date.now();
    const result = await service.createForAccount(accountId);
    const after = Date.now();

    const stored = await database.client.authSession.findUniqueOrThrow({
      where: { id: result.sessionId },
    });

    assert.equal(result.audience, 'marketplace');
    assert.equal(stored.accountId, accountId);
    assert.equal(stored.audience, 'MARKETPLACE');
    assert.equal(stored.revokedAt, null);
    assert.equal(
      stored.expiresAt.getTime() - stored.createdAt.getTime(),
      lifetimeMs,
    );
    assert.equal(
      result.sessionExpiresAt.getTime(),
      stored.expiresAt.getTime(),
    );
    assert.ok(stored.createdAt.getTime() >= before);
    assert.ok(stored.createdAt.getTime() <= after);

    console.log('PASS: session persisted with a seven-day lifetime.');

    await database.client.account.update({
      where: { id: accountId },
      data: { status: 'DISABLED' },
    });

    await expectRejected();

    assert.equal(
      await database.client.authSession.count({
        where: { accountId },
      }),
      1,
    );

    console.log('PASS: disabled account cannot create another session.');

    await database.client.account.update({
      where: { id: accountId },
      data: {
        status: 'ACTIVE',
        emailVerifiedAt: null,
      },
    });

    await expectRejected();

    assert.equal(
      await database.client.authSession.count({
        where: { accountId },
      }),
      1,
    );

    console.log('PASS: unverified account cannot create another session.');
  } finally {
    try {
      await database.client.account.deleteMany({
        where: { id: accountId },
      });

      assert.equal(
        await database.client.authSession.count({
          where: { accountId },
        }),
        0,
      );

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