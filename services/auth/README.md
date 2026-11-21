# GigZLK Auth Service

Owner: Member 2.

## Implementation status

Implemented and tested:

- NestJS service with validated port configuration.
- Liveness and database-backed readiness endpoints.
- Prisma 7.10.1 with PostgreSQL.
- Account, email-verification-token and service-assertion-replay schemas.
- Registration with Argon2id password hashing.
- Atomic email-token verification.
- Internal email/password credential validation.
- Bounded JWT decoding and strict JSON parsing.
- RS256 signature, header, identity, audience and timestamp validation.
- Trusted public-key configuration loaded at startup.
- Persistent replay consumption and final admission timing checks.
- Exact method/path matching for proposed internal Auth operations.
- Bearer-header extraction with duplicate-header rejection.
- Configured marketplace/admin BFF operation permissions.
- InternalAuthHttpService registered as a provider.
- Signed-request HTTP tests using a test-only controller.
- Authentication response caching controls.
- Multi-stage Docker builds with a non-root application runtime.

Pending:

- Production protected internal Auth controllers.
- Login and user access-token issuance.
- Sessions, refresh rotation, logout and revocation.
- User-token JWKS publication.
- CSRF integration and admin MFA.
- Verification-token issuance, resend and email delivery.
- Rate limiting and replay-record cleanup.
- Gateway-to-real-Auth and live BFF integration.
- Operational clock-reliability controls required before integration.

Production HTTP handlers do not call InternalAuthHttpService yet.
The protected login and MFA routes used in authentication tests exist
only in the test module and return test-only responses.

## Configuration

### PORT

Integer from 1 to 65535. Default: `3006`.

### DATABASE_URL

Auth-owned PostgreSQL connection string.

For host-based local development:

- Host: `127.0.0.1`
- Port: `5433`
- Database: `gigzlk_auth`
- User: `gigzlk_auth`

Use the Auth database password from local infrastructure configuration.
Do not use the PostgreSQL administrator account in application code.

Store local configuration in the ignored `services/auth/.env` file.
Prisma CLI loads it through `prisma.config.ts`.

The application reads process environment variables. For local execution,
load the file explicitly:

```powershell
node --env-file=.env dist/main.js
```

Database connections open on demand and close during application shutdown.

### AUTH_ASSERTION_KEYS_FILE

Path to a JSON file containing trusted BFF identities and public keys.

- If configured, the file must load successfully or startup fails.
- If unset, Auth can start, but assertion validation returns
  `503 AUTH_UNAVAILABLE`.
- Keys load once at startup. Configuration changes require a restart.
- This setting does not expose protected HTTP endpoints by itself.

### BFF permission configuration

Configure these settings together:

- `AUTH_MARKETPLACE_BFF_ISSUER`
- `AUTH_ADMIN_BFF_ISSUER`

They identify the issuers assigned marketplace and admin operation permissions.

Both values must be distinct and non-empty, without surrounding whitespace.
Partial or invalid permission configuration prevents startup.

When both settings are unset, InternalAuthHttpService rejects execution
with `503 AUTH_UNAVAILABLE` after checking the method/path and Bearer header.

These issuer values must match the corresponding trusted-key configuration.
The permission configuration alone does not establish trust in an issuer:
the assertion must also pass signature, identity and timing validation.

## Local development

Run from `services/auth` after configuring `DATABASE_URL`:

```powershell
npm.cmd ci
npx.cmd --no-install prisma migrate deploy
npm.cmd run build
node --env-file=.env dist/main.js
```

The build regenerates Prisma Client automatically.
Generated Prisma source is excluded from Git.

## Migrations

```powershell
npx.cmd --no-install prisma validate
npx.cmd --no-install prisma migrate deploy
npx.cmd --no-install prisma migrate status
```

Migration SQL is tracked in `prisma/migrations`.

Apply migrations as a controlled task, not during every application startup.
Do not edit migrations already applied to shared environments.

## Health endpoints

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/health/live` | Checks application liveness without querying PostgreSQL. |
| GET | `/health/ready` | Checks database access and Account table availability. |

Successful response:

```json
{"status":"UP","service":"auth"}
```

Readiness returns a safe HTTP 503 when its database query fails.
It does not verify the complete migration history, BFF connectivity,
gateway connectivity, permission configuration or clock synchronization.

A successful readiness response does not establish that internal
service authentication is configured.

Health routes are outside the business API prefix.

## Registration

`POST /api/v1/auth/register`

Request:

```json
{
  "email": "worker@example.com",
  "password": "a-long-example-password"
}
```

Success: HTTP 201.

```json
{
  "id": "<account UUID>",
  "status": "PENDING_VERIFICATION"
}
```

Input accepts only email and password.

- Email must be ASCII, valid and at most 254 characters after trimming.
- Normalized email lookup uses lowercase.
- Passwords must be 15 to 128 characters and are preserved exactly.

Passwords use Argon2id with:

- `memoryCost`: 19456 KiB
- `timeCost`: 2
- `parallelism`: 1

Registration creates a pending account. It does not assign roles, activate
the account, issue verification tokens or create a login session.
Responses exclude passwords and hashes.

| Status | Code or condition |
| --- | --- |
| 400 | Invalid input or unexpected fields |
| 409 | `ACCOUNT_ALREADY_EXISTS` |
| 503 | `REGISTRATION_UNAVAILABLE` |

PostgreSQL enforces normalized-email uniqueness, including concurrent requests.

The duplicate-email response reveals account existence. This is an explicit
MVP behavior to review before public exposure.

## Email verification

`POST /api/v1/auth/verify-email`

Request:

```json
{
  "token": "<64 lowercase hexadecimal characters>"
}
```

Success: HTTP 200.

```json
{"status":"VERIFIED"}
```

Verification atomically activates a pending account and consumes its token.

Expired, consumed, unknown or email-mismatched tokens cannot activate an
account. Disabled accounts cannot be activated. Concurrent reuse permits
exactly one successful verification.

Errors include:

- `400 INVALID_VERIFICATION_TOKEN`
- `503 EMAIL_VERIFICATION_UNAVAILABLE`

Invalid, expired and already-used tokens share one safe error response.

The token helper generates 32 random bytes with a proposed 30-minute lifetime.
The token table stores only the SHA-256 token hash.

Registration does not issue these tokens yet. Issuance, resend, email delivery
and rate limiting remain pending. Verification does not create a login session.

## Credential validation foundation

`CredentialsService` validates email/password credentials internally.

It trims and lowercases email for lookup, preserves the password exactly,
and verifies the stored Argon2id hash.

Only `ACTIVE` accounts with a non-null `emailVerifiedAt` can succeed.
Success returns only `accountId`; no session or token is issued.

Unknown accounts, incorrect passwords and inactive accounts receive the same
`401 INVALID_CREDENTIALS` response.

Unknown accounts still perform Argon2id verification against a dummy hash
initialized at startup. This reduces timing differences without guaranteeing
identical timing.

Database or hash-verification failures return
`503 CREDENTIAL_VERIFICATION_UNAVAILABLE`.

There is no production login HTTP endpoint yet.

## Service assertion validation

The service assertion profile is separate from user access tokens.

Implemented validation includes:

- Maximum compact JWT size: 4096 ASCII bytes.
- Maximum decoded header size: 512 bytes.
- Maximum decoded payload size: 2048 bytes.
- Three non-empty, unpadded, canonical base64url segments.
- Valid UTF-8 JSON objects without duplicate member names.
- Header fields restricted to `alg`, `typ` and `kid`.
- Algorithm: `RS256`.
- Token type: `gigzlk-service-assertion+jwt`.
- RSA public keys of at least 2048 bits.
- Exact configured issuer, subject and single-string service audience.
- `kid` matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`.
- `jti` matching `^[0-9a-f]{32}$`.
- Safe integer timestamps and a lifetime no greater than 60 seconds.
- At most five seconds of validation leeway.
- Rejection of issued-at timestamps more than five seconds ahead.
- Rejection of assertions older than 65 seconds.
- Rejection at or after `exp + 5 seconds`.

The five-second validator leeway does not extend the signer's
maximum 60-second assertion lifetime.

Token-supplied key URLs and embedded keys are not accepted.
Issuer and key ID select only keys already present in trusted configuration.

## Trusted public-key configuration

`AUTH_ASSERTION_KEYS_FILE` points to a JSON array.

Example structure, using a placeholder rather than a usable public key:

```json
[
  {
    "issuer": "urn:gigzlk:local:bff:marketplace",
    "subject": "marketplace-bff",
    "audience": "urn:gigzlk:local:auth-internal",
    "keys": [
      {
        "kid": "marketplace-current",
        "pem": "<SPKI public-key PEM>"
      }
    ]
  }
]
```

Add a separate entry with its own public keys for the admin BFF.

Each PEM must contain one `BEGIN PUBLIC KEY` block.
Private keys, certificates, non-RSA keys and malformed key data are rejected.

Key IDs are scoped to each issuer. Different issuers may use the same key ID
with different actual keys. Public keys cannot be shared across issuers.

Multiple keys per issuer support a rotation overlap.
The loader reads configuration only at startup; automatic reload is not implemented.

Auth receives public verification keys. BFF private signing keys belong
only to their respective BFF deployments.

## Bearer-header handling

`extractServiceAssertion` reads the original HTTP header list.

It requires:

- Exactly one Authorization header.
- A case-insensitive Bearer scheme followed by one space.
- A compact JWT containing three non-empty base64url sections.
- An encoded assertion no longer than 4096 ASCII characters.

Missing or malformed credentials and duplicate Authorization headers
produce `401 SERVICE_AUTH_INVALID`.

Header extraction does not establish authenticity. The extracted assertion
must still pass signature, claim and timing validation.

## BFF operation permissions

The permission map is configured by server-side issuer settings.

| Operation | Marketplace BFF | Admin BFF |
| --- | --- | --- |
| `/internal/v1/auth/login` | Allowed | Allowed |
| `/internal/v1/auth/refresh` | Allowed | Allowed |
| `/internal/v1/auth/session/check` | Allowed | Allowed |
| `/internal/v1/auth/logout` | Allowed | Allowed |
| `/internal/v1/auth/logout-all` | Allowed | Allowed |
| `/internal/v1/auth/mfa/challenge` | Denied | Allowed |

Unknown issuers receive no operation permission.
Issuer matching is exact and case-sensitive.

These are service-level permissions. They do not grant user roles,
authorize account access, establish an admin session or bypass MFA.

## Replay storage and admission

Replay records are unique on `(issuer, jti)` in Auth-owned PostgreSQL.

`AssertionReplayService` stores issuer, unique identifier, assertion expiry
and consumption time. It does not store raw assertions or user credentials.

- Duplicate consumption returns `401 SERVICE_AUTH_INVALID`.
- Database failures return `503 AUTH_UNAVAILABLE`.

`AssertionAdmissionService` performs:

1. Assertion validation.
2. A server-supplied operation permission check.
3. Committed replay consumption.
4. A final timestamp check.
5. Invocation of the protected operation.

Permission denial returns `403 SERVICE_ACCESS_DENIED` without consuming
a replay record.

If the final timestamp check fails, the committed replay record remains used
and the operation does not run. An operation admitted in time may finish
after the assertion's acceptance window closes.

Replay consumption does not establish business-operation idempotency.

Replay cleanup is not implemented. The agreed cleanup rule is eligibility
strictly after `expiresAt + 30 seconds`, using PostgreSQL time and the
documented clock-reliability controls.

To repeat the local PostgreSQL concurrency check:

```powershell
npm.cmd run build
node --env-file=.env scripts/check-assertion-replay.cjs
```

The check uses two independent database clients, expects exactly one success,
and removes its temporary replay record.

## Internal HTTP authentication foundation

`InternalAuthHttpService` combines:

1. Exact method and original-target matching.
2. Bearer-header extraction.
3. A check that BFF permission settings are available.
4. Assertion admission with the configured operation permission.
5. Invocation of the supplied operation.

It is registered in AppModule, but production controllers do not call it yet.

Current error behavior includes:

| Status | Code | Condition |
| --- | --- | --- |
| 404 | `NOT_FOUND` | Unlisted method or original request target |
| 401 | `SERVICE_AUTH_INVALID` | Missing, malformed, invalid, expired or replayed assertion |
| 403 | `SERVICE_ACCESS_DENIED` | Valid assertion issuer lacks operation permission |
| 503 | `AUTH_UNAVAILABLE` | Assertion configuration, permission configuration or replay infrastructure unavailable |

Signed-request HTTP tests use a test-only controller, real signature validation
and simulated replay storage. They verify:

- Successful admission of a valid signed request.
- Missing assertions rejected before replay consumption.
- Signatures from the wrong key rejected before replay consumption.
- Marketplace access to the admin MFA operation denied.
- Reuse of an assertion rejected.
- Replay-storage failure preventing operation execution.
- `Cache-Control: no-store` on the tested success and error responses.

These tests do not establish production endpoint availability,
real-database HTTP replay behavior or gateway-to-Auth integration.

## Internal routing and response caching

Exact uppercase `POST` requests are recognized for these proposed paths:

- `/internal/v1/auth/login`
- `/internal/v1/auth/refresh`
- `/internal/v1/auth/session/check`
- `/internal/v1/auth/logout`
- `/internal/v1/auth/logout-all`
- `/internal/v1/auth/mfa/challenge`

The routing check rejects unlisted methods and aliases, including trailing
slashes, query strings, percent encoding, duplicate slashes, dot segments,
backslashes, semicolon parameters and case variants.

Rejected internal requests return 404 without redirects.

Shared HTTP setup applies `Cache-Control: no-store` to:

- Requests under `/api/v1/auth`.
- Requests whose original target begins with `/internal`, case-insensitively.

The internal controllers used in HTTP tests exist only in test modules.
The operation allowlist does not create production endpoints.

The BFF and gateway must independently enforce caching and authentication
requirements at their boundaries.

## Docker and shared Compose

For a standalone host-published development container, run from `services/auth`:

```powershell
docker build -t gigzlk-auth:local .
docker run --rm --env-file .env.docker -p 127.0.0.1:3006:3006 gigzlk-auth:local
```

Use an ignored `.env.docker` file. On Docker Desktop, the database URL can
use `host.docker.internal:5433` to reach the host-published PostgreSQL port.
Inside the Auth container, `127.0.0.1` refers to that container.

The multi-stage build generates Prisma Client using a dummy build URL
without connecting to a database. The production runtime runs as a non-root
user and does not contain Prisma CLI or apply migrations.

For private Auth networking and the separate migration task, see
[Local Auth with Docker Compose](../../docs/deployment/auth-compose.md).

The shared Auth Compose setup does not publish an Auth host port.
Do not delete PostgreSQL volumes to resolve configuration errors.

## Integration contracts

- [Browser authentication](../../docs/api/browser-auth-v1.md)
- [Internal Auth sessions](../../docs/api/internal-auth-sessions-v1.md)
- [Auth platform](../../docs/architecture/auth-platform-v1.md)
- [Gateway setup and isolated tests](../../infrastructure/gateway/README.md)

These documents include proposed behavior and implementation gates.
A merged contract does not mean every described capability is implemented.

Member 4's isolated gateway tests use a mock Auth upstream. They do not
establish gateway-to-real-Auth integration.

A production protected endpoint and its implemented request/response contract
are required before connecting the gateway integration environment.

Live BFF integration remains disconnected.

Worker profiles, skills and availability belong to User Service.
Verification-email delivery integration is coordinated with Notification Service.

## Verification

Run from `services/auth`:

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd test -- --runInBand
npm.cmd run test:e2e -- --runInBand
npm.cmd audit --omit=dev
```

Latest reported Auth verification:

- Lint and build passed.
- 254 tests passed in the main suite.
- 50 end-to-end tests passed.

HTTP routing tests use raw request targets to avoid client-side normalization.

Earlier local PostgreSQL checks covered registration, stored password hashes,
email-token activation and rejection cases, rollback and concurrent replay.
Temporary records created by those checks were removed.

Earlier dependency audits reported zero production findings and 20 moderate
development findings in the Jest dependency chain. These are historical
results; rerun the audit to determine the current dependency status.