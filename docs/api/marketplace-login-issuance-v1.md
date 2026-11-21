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
## Member 1 review clarifications

Member 1 accepts the proposed issuance direction. Unresolved items remain
implementation blockers; this acceptance does not enable integration.

### Atomic issuance and response handling

Session creation and refresh-hash persistence share one transaction.
Return the complete credential envelope only after confirmed commit.
The BFF validates the complete envelope before setting cookies.

### Password-change race

Member 1 prefers credential versioning; Member 2 accepts it as the proposed
comparison mechanism.

Capture the credential version alongside the password hash during
verification. Recheck that version under the account lock before issuance.
Password changes must increment it using compatible locking.

Member 2 owns implementation and concurrency tests.
Credential versioning is not implemented by this document.

### Uncertain outcomes

Timeouts and lost commit acknowledgements produce no success response
or new cookies. Preserve existing browser cookies and report an operational
error without claiming issuance rolled back.

### Login retries and response ordering

Disable automatic login retries at the UI client, BFF, and gateway.
A fresh service assertion does not make another login attempt safe.

Before enabling login, Members 1 and 2 must agree on bounded operation
binding, concurrent duplicates, uncertain-attempt recovery, and prevention
of older responses overwriting newer cookies.

Disabling a submit button does not resolve multi-tab concurrency.

### Retained credential responses

Member 4 must review any proposed response-retention encryption,
key provisioning, access controls, expiry, and cleanup.

Ordinary logs and general-purpose caches are unsuitable for retaining
credential responses. No response-retention mechanism is approved here.

### Refresh and frontend verification

The BFF must not advertise or invoke refresh until rotation, lost-response
recovery, reuse detection, logout coordination, and cookie ordering are
reviewed and implemented.

Member 1's verification scope includes safe response mapping, unchanged
cookies on operational failure, no automatic retries, concurrent response
ordering, and no-store on every outcome.


## Member 4 review clarifications

Member 4 accepts the proposed atomic issuance direction, credential-version
comparison under the account lock, and operational-error handling for
uncertain commit outcomes.

Auth owns credential-version implementation and concurrency tests.

### Gateway retries

The current gateway uses proxy_next_upstream off.
Member 4's isolated failure tests verified no upstream retries in the
tested scenarios.

Member 4 will preserve this configuration and verify it against real Auth
during integration. BFF retry behavior remains owned by Member 1.

These isolated results do not establish verified end-to-end retry behavior.

### Credential-response retention requirements

No retained credential-response mechanism is approved or implemented.

If the bounded login-attempt design requires retained responses, it must
specify:

- Auth-owned storage using authenticated encryption.
- A dedicated, versioned runtime encryption key, separate from signing
  and service-assertion keys.
- Binding to the authenticated caller, operation, attempt identifier,
  and expiry.
- Expiry enforced on every retrieval, independently of cleanup.
- Concrete retention limits and cleanup behavior.
- Key rotation, key-loss recovery, and backup handling.
- No plaintext credentials in logs, traces, backups, or general-purpose
  caches.

Unavailable storage or decryption must produce an operational error.
Uncertain commits must not be described as rolled back.
Existing BFF cookies must be preserved on operational failure.

### Next agreement

Members 1 and 2 will define the bounded login-attempt contract.
Member 4 will review its concrete infrastructure requirements.

Acceptance covers the issuance direction only. Outstanding contracts,
implementation, and tests remain prerequisites.

Login issuance, refresh, and live integration remain disconnected.
Login issuance, refresh, and live integration remain disconnected.

## Proposed bounded login-attempt contract

Status: PROPOSED — requires Members 1 and 4 review.

### Attempt identity and binding

The BFF generates a cryptographically random attempt identifier containing
at least 128 bits of randomness for each explicit login attempt.

Auth binds the attempt to:
- The authenticated BFF caller.
- The marketplace audience.
- The login operation.
- A server-issued pre-session context.
- The submitted credential payload through a keyed fingerprint.

The pre-session context must be validated by the BFF and bound to its
HttpOnly context cookie and CSRF protection. A browser-supplied context
identifier alone is insufficient.

The keyed fingerprint covers the normalized email and exact password,
using an unambiguous encoding and a dedicated runtime-provisioned HMAC key.
Never persist the plaintext password or an unkeyed password fingerprint.

Exact wire fields, context transport, fingerprint encoding, and key
configuration require agreement before implementation.

### Proposed bounds

- An attempt may begin issuance for five minutes after Auth admits it.
- Duplicate-prevention metadata remains for twenty-four hours.
- Admission expiry is checked before issuance writes.
- An expired attempt cannot be restarted or reused.
- Unknown identifiers cannot recreate an expired attempt: admission
  requires an unexpired server-issued attempt context.
- Cleanup never substitutes for expiry checks.
- Admission and recovery require reviewed rate and storage limits.

These durations are proposed defaults, not implemented guarantees.

### Duplicate handling

A database uniqueness constraint binds caller, operation, and attempt ID.

Concurrent requests for the same attempt cannot create separate sessions.
Different payloads for the same attempt are rejected without changing
the original attempt.

A duplicate in-progress request returns an operational conflict without
credentials or cookie changes. It does not start another verification
or issuance operation.

Automatic retries remain disabled at the UI, BFF, and gateway.

### Atomic completion

The issuance transaction must lock the attempt record and account using
a documented, consistent lock order.

The transaction rechecks attempt expiry, account eligibility, and the
credential version captured during password verification.

Session creation, refresh-hash persistence, and marking the attempt as
committed share one transaction. The attempt records its associated
session ID.

Signing occurs before commit. Credentials are returned only after
confirmed commit.

A stale worker cannot commit after recovery has cancelled its attempt.

### No retained credential responses

This proposal stores no recoverable access or refresh credential response.

A duplicate request after commit must not return AUTHENTICATED without
credentials, mint replacement credentials, or create another session.

It returns a safe attempt-state response requiring explicit recovery.
Attempt-state responses are server-only and require the same caller and
validated pre-session binding. They never establish user authentication.

The original complete credential envelope is returned only by the
successful issuance operation after confirmed commit.

### Uncertain-outcome recovery

A timeout or lost acknowledgement leaves the browser outcome uncertain.
The BFF preserves existing cookies and reports an operational error.

Recovery is an explicit user action, not an automatic login retry.

Auth locks the attempt record before resolving it:
- If committed, revoke only the session associated with that attempt
  and mark the attempt cancelled in the same transaction.
- If issuance has not committed, cancel the attempt so an existing
  worker cannot later issue credentials for it.
- If the state cannot be established or cancellation cannot be confirmed,
  return an operational error and do not authorize a replacement attempt.

Only after confirmed cancellation may an explicit new login attempt
proceed with a fresh attempt ID and fresh credential verification.

Recovery must also work when the browser received credentials but the BFF
did not record delivery. The old session may be revoked; the user must
complete a new login.

Session revocation does not invalidate an already signed offline token
immediately. Existing access tokens may remain usable until expiry.
Sensitive operations require authoritative current-state checks.

### Browser concurrency and cookie ordering

Auth duplicate prevention does not solve browser cookie ordering.

Before enabling login, Member 1 must specify how all tabs and BFF replicas
sharing the same browser context serialize login and recovery.

An older HTTP response must not overwrite credentials from a newer
attempt. A server-side generation check alone is insufficient if an older
Set-Cookie response is already in flight.

The review must cover delayed responses, browser reloads, multi-tab
requests, expired coordination leases, logout, and recovery.

This browser delivery protocol remains an explicit integration blocker.

### Storage and recovery behavior

Attempt records and fingerprints are Auth-owned and access-restricted.
They must not enter ordinary application logs or general-purpose caches.

Dedicated fingerprint keys require versioning and bounded retention.
Unavailable keys or storage deny admission and recovery.

Backups and restore procedures must prevent old attempt records or
sessions from being revived as valid issuance state. Concrete recovery
and retention procedures require Member 4 review.

No credential-response encryption key is required by this proposal because
recoverable credential responses are not retained.

### Required tests

- Concurrent identical attempts create at most one session.
- Payload mismatch cannot reuse an attempt.
- Caller, operation, audience, and context isolation.
- Five-minute admission and twenty-four-hour retention boundaries.
- Cancellation racing with password verification and issuance.
- Signing failure rolls back session and refresh writes.
- Lost commit acknowledgement resolves through durable attempt state.
- Recovery revokes only the session belonging to its attempt.
- Cancelled or expired attempts cannot be resurrected.
- Password changes invalidate an earlier credential version.
- Delayed responses cannot overwrite newer browser cookies.
- Storage/key failures preserve existing cookies and return no success.
- No-store and secret exclusion on every outcome.

### Review decisions required

Member 1: agree on the context binding, explicit recovery UX, and a
concrete browser delivery/ordering protocol.

Member 2: define attempt state transitions, wire schemas, transaction
locking, payload fingerprinting, and concurrency tests.

Member 4: review bounds, storage limits, runtime fingerprint keys,
backup/restore behavior, and gateway integration.

This is a proposal, not an implemented login-attempt mechanism.
Login issuance, refresh, and live integration remain disconnected.