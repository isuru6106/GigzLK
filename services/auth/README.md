# GigZLK Auth Service

Owner: Member 2.

## Implemented

- NestJS health endpoints and validated PORT configuration.
- Prisma 7.10.1 with PostgreSQL adapter.
- Account schema and initial migration.
- Prisma Client generation before application builds.
- Multi-stage Docker build with a non-root runtime.

The account schema stores email, a unique normalized email lookup,
password hash, account status, verification time and record timestamps.
Accounts default to PENDING_VERIFICATION.

Registration and email-token verification are implemented.
Login, sessions, JWT/JWKS, MFA, service-token issuance and verification
email delivery are not implemented.

## Configuration

PORT: integer from 1 to 65535; default 3006 (proposed local Auth port).

DATABASE_URL: Auth-owned PostgreSQL connection string.
Local host connections use 127.0.0.1:5433 and database/user gigzlk_auth.
Use the Auth password from your local infrastructure configuration.
Never use the PostgreSQL administrator login in application code.

Keep credentials in an ignored services/auth/.env file.
Prisma CLI loads this file through prisma.config.ts.
The application requires DATABASE_URL in its environment. For local execution,
use node --env-file=.env dist/main.js after building. Database connections are
opened on demand and closed during application shutdown.

## Local development

Run from services/auth after configuring DATABASE_URL:

```powershell
npm.cmd ci
npm.cmd run prisma:generate
npx.cmd --no-install prisma migrate deploy
npm.cmd run build
node --env-file=.env dist/main.js
```

Generated Prisma source is excluded from Git.
npm run build regenerates the client automatically.

## Migrations

```powershell
npx.cmd --no-install prisma validate
npx.cmd --no-install prisma migrate deploy
npx.cmd --no-install prisma migrate status
```

Migration SQL is tracked in prisma/migrations.
Run migrations as a controlled task, not on every application startup.
Do not edit migrations already applied to shared environments.

## Health endpoints

GET /health/live
GET /health/ready

Response: {"status":"UP","service":"auth"}

Liveness does not access PostgreSQL. Readiness queries the Account table
and returns a safe HTTP 503 when that query fails. It checks database access
and Account table availability, but does not validate the full migration state.
Health routes remain outside the proposed /api/v1 business API prefix.

## Verification

```powershell
npm.cmd test -- --runInBand
npm.cmd run test:e2e -- --runInBand
npm.cmd run build
npm.cmd run lint
npm.cmd audit --omit=dev
```

A local Prisma transaction smoke test verified account creation,
default values, lookup and rollback without retaining the test account.

The development dependency audit reported 20 moderate findings in
the Jest dependency chain. Production audit reported zero findings
at verification time. Development findings remain follow-up work.

## Docker

Run from services/auth:

```powershell
docker build -t gigzlk-auth:local .
docker run --rm --env-file .env.docker -p 127.0.0.1:3006:3006 gigzlk-auth:local
```

Client generation uses a dummy build URL without connecting to a database.
The runtime contains production dependencies and compiled Prisma Client.
The image does not include Prisma CLI or run migrations.
Press Ctrl+C to stop the foreground container.

## Integration

Browser authentication and service-token contracts remain proposals.
Shared Compose and CI configuration are coordinated by Member 4.
Worker profiles, skills and availability belong to User Service.

For Docker Desktop, supply DATABASE_URL through an ignored .env.docker file.
Use host.docker.internal:5433 to reach the host-published PostgreSQL port;
127.0.0.1 inside the Auth container refers to that container itself.
Never commit this file or its credentials.


## Registration

POST /api/v1/auth/register

Request:
{"email":"worker@example.com","password":"a-long-example-password"}

Response: HTTP 201
{"id":"<account UUID>","status":"PENDING_VERIFICATION"}

Input accepts only email and password. Email must be ASCII, valid and
at most 254 characters after trimming. Login lookup uses lowercase email.
Passwords must be 15 to 128 characters and are preserved exactly as entered.
These input policies and the response contract are proposed for frontend integration.

Passwords use Argon2id with memoryCost 19456 KiB, timeCost 2 and parallelism 1.
Responses exclude passwords and hashes. Registration issues no session,
assigns no role and does not activate the account.

Errors:
- 400: invalid input or unexpected fields.
- 409 ACCOUNT_ALREADY_EXISTS: normalized email already exists.
- 503 REGISTRATION_UNAVAILABLE: database operation failed.

Uniqueness is enforced by PostgreSQL, including concurrent requests.
The duplicate-email response reveals account existence; this is an explicit
MVP behavior to review before public exposure.
Rate limiting, verification-token issuance and email delivery remain follow-up work.

Verification included real PostgreSQL registration, duplicate rejection,
stored-hash verification and test-account cleanup. Argon2id hashing and
verification also passed in the Linux production image.

## Email verification foundation

POST /api/v1/auth/verify-email

Request:
{"token":"<64 lowercase hexadecimal characters>"}

Success: HTTP 200
{"status":"VERIFIED"}

Verification atomically activates a pending account and consumes its token.
Expired, consumed, unknown or email-mismatched tokens cannot activate an
account. Disabled accounts cannot be activated through this endpoint.
Concurrent reuse permits exactly one successful verification.

The token helper generates 32 random bytes with a proposed 30-minute
lifetime. Only the SHA-256 token hash is stored in the database.

Token issuance, resend, email delivery and rate limiting are not implemented.
Registration continues to create pending accounts without issuing tokens.
Notification integration remains open for agreement with Member 3.
Verification does not create a login session.

Verification evidence:
- Automated token-helper and HTTP validation/response tests.
- Manual local PostgreSQL checks for activation, replay rejection,
  expiry rollback, disabled accounts, email mismatch and concurrent reuse.
- Temporary integration-test accounts and tokens were removed.

## Credential validation foundation

CredentialsService validates email/password credentials internally.
It normalizes email using trim and lowercase, preserves the exact password,
and verifies the stored Argon2id hash.

Only ACTIVE accounts with a non-null emailVerifiedAt can succeed.
Success returns only accountId; no session or token is issued.

Unknown accounts, incorrect passwords and inactive accounts receive the
same INVALID_CREDENTIALS response. Unknown accounts still perform an
Argon2id verification using a dummy hash initialized at application startup.
This reduces timing differences; it does not guarantee identical timing.

Database or hash-verification failures return a safe
CREDENTIAL_VERIFICATION_UNAVAILABLE response.

No login HTTP endpoint is exposed. Browser authentication, session/token
issuance and login rate limiting remain pending.

Validation includes real Argon2 hashing with mocked database lookups,
DTO validation and existing HTTP regression tests.

## Browser authentication draft

See [Browser authentication contract](../../docs/api/browser-auth-v1.md) for the proposed BFF,
session, CSRF, refresh and MFA behavior.

This is a review draft. Session APIs and live frontend integration are
not implemented; unresolved decisions are marked OPEN.

## Authentication response caching

Shared HTTP setup applies Cache-Control: no-store to /api/v1/auth
responses, including validation errors, service failures and unmatched routes
under that path. Registration and verification HTTP tests assert the header.

The Next.js BFF must independently enforce no-store.
BFF behavior and live integration remain unverified.

## Shared Compose development

See [Local Auth with Docker Compose](../../docs/deployment/auth-compose.md)
for private networking, local database-secret generation, controlled
migrations and container health checks.

This setup does not enable gateway or BFF authentication integration.