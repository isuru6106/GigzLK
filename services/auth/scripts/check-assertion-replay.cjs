const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { DatabaseService } = require('../dist/database.service.js');
const {
  AssertionReplayService,
} = require('../dist/service-auth/assertion-replay.service.js');

const databases = [new DatabaseService(), new DatabaseService()];
const services = databases.map((db) => new AssertionReplayService(db));

const issuer = 'urn:gigzlk:test:replay';
const jti = randomBytes(16).toString('hex');

async function main() {
  try {
    const expiresAt = new Date(Date.now() + 60_000);

    const results = await Promise.allSettled(
      services.map((service) => service.consume(issuer, jti, expiresAt)),
    );

    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1,
    );

    const rejected = results.find((result) => result.status === 'rejected');
    assert.equal(rejected?.reason.getStatus(), 401);

    assert.equal(
      await databases[0].client.serviceAssertionReplay.count({
        where: { issuer, jti },
      }),
      1,
    );

    console.log('PASS: concurrent attempts allow exactly one success.');
  } finally {
    await databases[0].client.serviceAssertionReplay.deleteMany({
      where: { issuer, jti },
    });
    await Promise.all(databases.map((db) => db.onModuleDestroy()));
  }
}

main().catch(() => {
  console.error('FAIL: replay check or cleanup failed; details withheld.');
  process.exitCode = 1;
});