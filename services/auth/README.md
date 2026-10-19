# GigZLK Auth Service

Owner: Member 2.

## Current scope

NestJS/TypeScript service foundation with health endpoints,
validated port configuration, tests and a Docker image.

Registration, login, sessions, JWT/JWKS, MFA, database integration
and service-token issuance are not implemented yet.

## Configuration

PORT: integer from 1 to 65535.
Default: 3006 (proposed local Auth port).

Configuration is read from process environment variables.
.env files are not automatically loaded.

## Local development

Run from services/auth:

```powershell
npm.cmd ci
npm.cmd run start:dev
```

## Health endpoints

GET /health/live
GET /health/ready

Both currently return:
{"status":"UP","service":"auth"}

Readiness covers this dependency-free foundation only.
Database readiness checks must be added when persistence is introduced.

Health routes are outside the proposed /api/v1 business API prefix.

## Verification

```powershell
npm.cmd test -- --runInBand
npm.cmd run test:e2e -- --runInBand
npm.cmd run build
npm.cmd run lint
```

## Docker

Run from services/auth:

```powershell
docker build -t gigzlk-auth:local .
docker run --rm -p 127.0.0.1:3006:3006 gigzlk-auth:local
```

The runtime uses a non-root user and production dependencies.
Press Ctrl+C to stop the foreground container.

## Integration status

Browser authentication and service-to-service token contracts
remain proposals requiring agreement with integration owners.
This foundation does not provide authentication to other services.
Shared Compose and CI configuration are coordinated by Member 4.
