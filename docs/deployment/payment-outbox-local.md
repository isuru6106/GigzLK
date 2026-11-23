# Payment outbox worker — local development

## Scope

The standalone worker publishes stored Payment outbox events to Kafka.
Starting the Payment HTTP application does not start this worker.

This runner requires NODE_ENV=development and loopback Kafka brokers.
TLS, service authentication and topic ACLs are not configured here.

## Prerequisites

- Docker PostgreSQL and Kafka are healthy.
- gigzlk_payment_test exists and has all Payment migrations applied.
- services/payment/.env.test points to gigzlk_payment_test.
- .env.test is ignored by Git.
- The Kafka topic gigzlk.payment.outbox-test.v1 exists.

Never commit credentials or paste environment-file contents into logs.

## Run

From services/payment in PowerShell:

```powershell
npm.cmd run build

$env:NODE_ENV = 'development'
$env:OUTBOX_ENABLED = 'true'
$env:KAFKA_BROKERS = '127.0.0.1:9092'
$env:KAFKA_PAYMENT_TOPIC = 'gigzlk.payment.outbox-test.v1'
$env:OUTBOX_POLL_INTERVAL_MS = '1000'

npm.cmd run start:outbox:test
```

Check that .env.test selects gigzlk_payment_test before starting.
Existing process environment variables take precedence over the env file.

Press Ctrl+C once to stop. The runner finishes its current operation,
then disconnects from Kafka and PostgreSQL.

Stop the runner before integration tests so it cannot claim their events.

## Delivery behavior

- Claims last 60 seconds and use database time.
- Processing is sequential within each runner.
- Publication is recorded only after Kafka acknowledges the send.
- Six claimed attempts are allowed: the initial attempt plus five retries.
- Crashed claims also consume attempts.
- Retries use exponential delay with jitter.
- Exhausted events retain failedAt and require intervention.
- An unpublished earlier aggregate version blocks later versions.
- Expired or replaced claim holders cannot record completion.
- Kafka acknowledgement and the database update are not atomic.
  Duplicate delivery remains possible; consumers must durably deduplicate
  using eventId.

No operational replay command or Notification consumer is implemented yet.
Publishing errors currently use bounded retries; specific non-retryable
Kafka error classification remains outstanding.

## Known investigation items

- A TimeoutNegativeWarning occurs with KafkaJS in this local Node setup,
  including outside Jest. Its cause remains unresolved.
- The first live delivery test timed out. A subsequent run and three
  consecutive repeat runs passed; the original timeout remains unexplained.
- Local single-broker success does not establish production readiness.

## Deployment work remaining

Coordinate broker addresses, TLS, service credentials, topic permissions,
retention, monitoring and worker deployment with Member 4.