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

Registration, login, email verification, sessions, JWT/JWKS, MFA and
service-token issuance are not implemented.

## Configuration

PORT: integer from 1 to 65535; default 3006 (proposed local Auth port).

DATABASE_URL: Auth-owned PostgreSQL connection string.
Local host connections use 127.0.0.1:5433 and database/user gigzlk_auth.
Use the Auth password from your local infrastructure configuration.
Never use the PostgreSQL administrator login in application code.

Keep credentials in an ignored services/auth/.env file.
Prisma CLI loads this file through prisma.config.ts.
The NestJS application does not currently load .env or connect to PostgreSQL.

## Local development

Run from services/auth after configuring DATABASE_URL:

```powershell
npm.cmd ci
npm.cmd run prisma:generate
npx.cmd --no-install prisma migrate deploy
npm.cmd run start:dev
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

Readiness currently covers the HTTP foundation only.
It does not verify database connectivity or migration state.
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
docker run --rm -p 127.0.0.1:3006:3006 gigzlk-auth:local
```

Client generation uses a dummy build URL without connecting to a database.
The runtime contains production dependencies and compiled Prisma Client.
The image does not include Prisma CLI or run migrations.
Press Ctrl+C to stop the foreground container.

## Integration

Browser authentication and service-token contracts remain proposals.
Shared Compose and CI configuration are coordinated by Member 4.
Worker profiles, skills and availability belong to User Service.