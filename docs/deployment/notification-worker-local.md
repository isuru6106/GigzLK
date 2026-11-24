# Local Notification Delivery Worker

Status: local simulation only. No real email is sent.

## Prerequisites

- Node.js and installed Notification service dependencies.
- Local PostgreSQL with the Notification migrations applied.
- An ignored `services/notification/.env.test` containing:
  - DATABASE_URL targeting local `gigzlk_notification_test`.
  - NOTIFICATION_ENCRYPTION_KEY_ID.
  - NOTIFICATION_ENCRYPTION_KEY_BASE64: a random 32-byte key encoded as Base64.
- Notification records must be encrypted with the configured key and key ID.

Never commit or print secret values.

## Build and start

Run from `services/notification`:

    npm.cmd run build

    $env:NODE_ENV = 'development'
    $env:NOTIFICATION_WORKER_ENABLED = 'true'

    npm.cmd run start:notification:test

Stop with Ctrl+C. If Windows asks to terminate the batch job, answer Y.

Keep the worker stopped while running database integration tests.

## Behavior

- Claims one eligible notification at a time.
- Uses a 60-second claim and checks ownership before dispatch.
- Simulates delivery without sending email.
- Retries definite retryable failures, up to five total attempts.
- Does not automatically resend uncertain deliveries.
- Recovers expired sending claims as uncertain delivery.
- Checks cancellation immediately before dispatch.
- Deletes terminal payloads and expires uncertain payloads.
- Deletes terminal metadata after its seven-day retention period.
- Processes recovery and metadata cleanup in batches of up to 100 per cycle.

Cancellation is best effort once delivery begins.

## Current limitations

- No real provider or live Auth integration.
- No authenticated notification HTTP routes.
- The local runner loads one encryption key; production key-ring
  configuration and rotation remain pending.
- Database integration tests use synthetic keys. Do not run the local
  worker alongside those tests.