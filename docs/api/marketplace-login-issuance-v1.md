# Marketplace login issuance design

Status: PROPOSED — implementation and live integration disconnected
Owner: Member 2
Reviewers: Members 1 and 4

## Related contracts

- [Browser authentication](browser-auth-v1.md)
- [Internal Auth sessions](internal-auth-sessions-v1.md)
- [Marketplace access tokens](marketplace-access-token-v1.md)

## Current implementation

Auth implements credential validation with authenticatedAt, marketplace
session persistence, access-token signing, and current-key JWKS publication.

Session persistence and authentication-time deadlines have been checked
against PostgreSQL.

These components do not constitute an implemented login endpoint.
Refresh issuance, rotation, logout, and current-state checks remain pending.

## Ownership

- Member 2: credential validation, session state, credential issuance,
  access signing, and public JWKS publication.
- Member 1: BFF cookies, CSRF, explicit browser response mapping,
  token verification, and JWKS caching.
- Member 4: private routing, exact public discovery routing, runtime
  secret provisioning, and infrastructure integration tests.

## Trusted inputs

Authenticate and authorize the BFF before processing login credentials.
Derive the marketplace audience from the authenticated BFF identity.

The browser supplies only the documented email and password fields.
It cannot select accountId, sessionId, audience, issuer, or authenticatedAt.

CredentialsService returns accountId and authenticatedAt only after
successful password verification and account eligibility checks.

The Auth issuer comes from validated server configuration.
Signing keys remain separate from BFF assertion keys.

## Proposed issuance sequence

1. Authenticate and authorize the marketplace BFF.
2. Validate request fields and apply the reviewed login rate limits.
3. Verify credentials and capture authenticatedAt.
4. Generate an opaque refresh credential using a cryptographically secure
   random source. Keep its raw value only in transient server memory.
5. Begin a database transaction.
6. Lock and recheck the account's ACTIVE and email-verified state.
7. Recheck that the credential state verified in step 3 has not changed.
   A password change between verification and this transaction must prevent
   issuance. The implementation must define and test this comparison.
8. Create the marketplace session with the original authenticatedAt and
   an absolute deadline of authenticatedAt plus seven days.
9. Persist the refresh credential hash and its session association.
10. Sign the access token using the newly created session ID, original
    authenticatedAt, and stored session deadline.
11. Commit the transaction.
12. Return the complete server-only credential envelope only after commit
    succeeds.

Password hashing and verification occur before the transaction to avoid
holding database locks during expensive password verification.

Token signing occurs inside the transaction, before commit.
Do not reuse createForAccount as a separately committed issuance step.
The implementation must keep session and refresh writes in one transaction.

## Failure behavior

- Invalid credentials or ineligible account: 401 INVALID_CREDENTIALS.
- Missing signing infrastructure, random-generation failure, signing
  failure, or storage failure: 503 AUTH_UNAVAILABLE.
- A failure before commit must roll back session and refresh writes.
- Never return an AUTHENTICATED envelope containing partial credentials.
- Never expose raw errors, hashes, passwords, or credentials in logs.
- A commit acknowledgement failure may leave the commit outcome unknown.
  Do not claim that the transaction certainly rolled back.
- A response lost after commit may leave a valid session that the browser
  never received. Do not automatically issue a replacement session.

## Successful response

Use the server-only authenticated envelope defined in
internal-auth-sessions-v1.md.

It includes accountId, sessionId, audience, accessToken,
accessExpiresAt, refreshToken, and sessionExpiresAt.

Auth returns no browser-domain cookies.
The BFF explicitly maps the response, sets reviewed HttpOnly cookies,
and returns only allowlisted safe browser state.

All login responses, including errors, require Cache-Control: no-store.

## Authentication time and deadlines

Persist the actual successful password-authentication time.
Do not substitute transaction time or refresh time.

The marketplace absolute deadline is authenticatedAt plus seven days.
Access expiry cannot exceed that deadline.
Refresh must preserve authenticatedAt and the absolute deadline.

Legacy sessions with NULL authenticatedAt are ineligible for credential
issuance or refresh. Require a new successful login; do not backfill an
invented authentication time.

## Retry and idempotency

Until a separate bounded login-idempotency contract is accepted:

- BFFs, gateways, and HTTP clients must not automatically retry login.
- A timeout or connection failure does not prove that no session exists.
- A fresh service assertion does not make a duplicate login idempotent.
- Assertion replay prevention and login idempotency are distinct controls.

Before enabling login, specify how an uncertain attempt is handled,
including operation binding, expiry, concurrent duplicates, and browser
cookie ordering. If credential responses are retained for retries, define
encryption, access controls, retention limits, and cleanup.

## Refresh prerequisites

The proposed login envelope must not advertise a usable refresh capability
before the corresponding lifecycle is implemented and reviewed.

The following remain unresolved:

- Exact refresh credential format, entropy, hash representation, and schema.
- Atomic rotation and credential-family state.
- Simultaneous refreshes across tabs and BFF replicas.
- Lost-response retries and bounded response retention.
- Reuse detection without an unrestricted grace period.
- Coordination with logout and audience-scoped logout-all.
- Prevention of stale responses overwriting newer cookies.

These are design prerequisites, not implemented guarantees.

## Required verification

- Exact successful internal and safe browser response mappings.
- Service identity and marketplace audience isolation.
- Password changes between verification and session creation.
- Account eligibility rechecked under the transaction lock.
- Authentication time and fixed session deadlines.
- Real PostgreSQL rollback when signing or refresh persistence fails.
- No success response when commit fails or its outcome is uncertain.
- No partial credentials or secret-bearing logs.
- Lost-response and duplicate-attempt behavior.
- No-store headers at Auth, BFF, and gateway boundaries.
- Runtime key mounts and public-only JWKS responses.

## Integration status

This document proposes an issuance design.
It does not enable login, refresh, or live integration.

Members 1 and 4 must review the remaining retry, refresh, and infrastructure
details before endpoint integration.