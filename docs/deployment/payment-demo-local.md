# Local Payment Demo

Demonstrates internal payment logic using synthetic records.
No real money is transferred.

## Prerequisites

- Run commands from services/payment.
- Local PostgreSQL must be running.
- An ignored .env.test file must provide DATABASE_URL for
  gigzlk_payment_test on localhost or 127.0.0.1.
- The database role must be able to create and drop schemas.
- Install dependencies and generate Prisma Client.

## Run

```powershell
npx.cmd --no-install prisma generate --config ./prisma7.config.ts
npm.cmd run build

npm.cmd run demo:payment -- SUCCEEDED
npm.cmd run demo:payment -- FAILED
```

Each run creates a unique temporary schema, applies migrations,
runs the demonstration and removes the schema afterward.

## Demonstrated flow

1. Create a synthetic payment for LKR 10,000.
2. Simulate funding and verify duplicate confirmation makes no change.
3. Record internal approval and verify an identical retry.
4. Release funds into a balanced journal:
   - Commission: LKR 1,000.
   - Worker payable: LKR 9,000.
5. Record simulated payout success or failure and verify its retry.
6. Verify release and simulated-payout outbox events.

## Limits

- Does not exercise HTTP authorization, publisher ownership or
  authoritative completion checks.
- Does not publish to Kafka.
- Does not contact a payment provider or settle real funds.
- Failed simulated payouts are terminal in this version.
- An interrupted process may leave its temporary schema behind.