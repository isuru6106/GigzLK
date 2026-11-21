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
Credential versioning, refresh issuance, rotation, logout, current-state
checks, and the login-attempt mechanism remain pending.

## Ownership

- Member 2: credential validation, session state, credential issuance,
  access signing, and public JWKS publication.
- Member 1: BFF cookies, CSRF, explicit browser response mapping,
  token verification, and JWKS caching.
- Member 4: private routing, exact public discovery routing, runtime
  secret provisioning, and infrastructure integration tests.

## Review status

Members 1 and 4 accept the atomic issuance direction, credential-version
comparison under the account lock, and operational-error handling for
uncertain commit outcomes.

Member 1 accepts explicit recovery without retained credential responses
in principle, but has not accepted the complete login-attempt mechanism.

The five-minute issuance and twenty-four-hour metadata durations are
acceptable frontend defaults to Member 1, subject to completion-expiry
clarification and Member 4's storage/key review.

Browser delivery ordering, admission proofs, detailed wire contracts,
storage limits, and recovery procedures remain unresolved.

A merged document does not establish acceptance of every proposal in it.

## Trusted inputs

Authenticate and authorize the BFF before processing login credentials.
Derive the marketplace audience from the authenticated BFF identity.

The browser supplies only fields allowed by the reviewed browser contract.
It cannot select accountId, sessionId, audience, issuer, or authenticatedAt.

Attempt and context fields are proposed server-only additions. They require
explicit BFF request mapping and must not be trusted merely because they
appear in a request body.

CredentialsService currently returns accountId and authenticatedAt after
successful password verification and account eligibility checks.

The proposed implementation must also capture the credential version
alongside the password hash used for verification.

The Auth issuer comes from validated server configuration.
Access-signing keys remain separate from service-assertion keys.

## Credential-version comparison

Capture the account's credential version with the password hash before
password verification.

During issuance, lock the account and compare the stored version against
the version associated with successful verification.

A mismatch prevents issuance. Do not automatically verify again or create
a replacement attempt.

Password changes must update the password hash and increment the version
atomically using compatible account locking.

Member 2 owns implementation and concurrency tests.

Versioning prevents issuance based on stale password verification. It does
not by itself define revocation of sessions issued before a password change.

## Proposed issuance sequence

1. Authenticate and authorize the marketplace BFF.
2. Validate the request, context binding, and reviewed rate limits.
3. Durably admit the attempt before password verification begins.
4. Atomically bind the first credential payload and claim verification
   ownership for the attempt.
5. Verify credentials outside the issuance transaction. Capture accountId,
   authenticatedAt, and the credential version used for verification.
6. Generate an opaque refresh credential using a cryptographically secure
   random source. Keep its raw value only in transient server memory.
7. Begin the issuance transaction and lock the attempt.
8. Verify ownership, caller/context binding, state, and attempt expiry.
9. Lock the account and recheck ACTIVE status, verified email, and the
   captured credential version.
10. Create the marketplace session with the original authenticatedAt and
    an absolute deadline of authenticatedAt plus seven days.
11. Persist the refresh credential hash and its session association.
12. Sign the access token using the new session ID, original authenticatedAt,
    and stored session deadline.
13. Recheck issuance expiry immediately before the conditional update marking
    the attempt COMMITTED and recording its associated session ID.
14. Commit the transaction.
15. Return the complete server-only credential envelope only after confirmed
    commit.

Password verification occurs outside the issuance transaction to avoid
holding database locks during expensive password verification.

Signing occurs inside the issuance transaction before commit.

Session creation, refresh-hash persistence, and the COMMITTED transition
must share one transaction.

Do not reuse createForAccount as a separately committed issuance step.

The proposed lock order is attempt, then account, then associated session
or refresh records where required. Every participating operation must use
a compatible order. Final coordination with password changes, refresh,
logout, and logout-all requires concurrency review.

## Failure behavior

- Invalid credentials or ineligible account: 401 INVALID_CREDENTIALS.
- Missing signing infrastructure, random-generation failure, signing
  failure, or storage failure: 503 AUTH_UNAVAILABLE.
- A failed issuance transaction must roll back its session and refresh
  writes. A previously committed admission record may remain.
- Never return an AUTHENTICATED envelope with partial credentials.
- Never expose raw errors, passwords, hashes, or credentials in logs.
- A lost commit acknowledgement can leave the outcome unknown.
  Do not claim that issuance certainly rolled back.
- A response lost after commit may leave a valid session that the browser
  never received. Do not automatically issue a replacement.
- Operational failures must not install new cookies or clear unrelated
  existing browser cookies.

## Successful response

Use the complete server-only authenticated envelope defined in
internal-auth-sessions-v1.md.

It includes status, accountId, sessionId, audience, accessToken,
accessExpiresAt, refreshToken, and sessionExpiresAt.

Auth does not set browser-domain cookies.

The BFF must validate the complete envelope before any credential
installation and return only allowlisted safe browser state.

The existing rotating-cookie contract remains subject to the unresolved
browser delivery protocol below. Cookie installation stays disconnected.

All login responses, including errors, require Cache-Control: no-store
at Auth, BFF, and gateway boundaries.

## Authentication time and session deadlines

Persist the actual successful password-authentication time.
Do not substitute transaction time or refresh time.

The marketplace absolute deadline is authenticatedAt plus seven days.
Database delays cannot extend that deadline.

Access expiry cannot exceed the stored session deadline.
Refresh must preserve authenticatedAt and the absolute deadline.

Legacy sessions with NULL authenticatedAt are ineligible for credential
issuance or refresh. Require a new successful login; do not backfill an
invented authentication time.

## Retry policy

Disable automatic login retries at the UI client, BFF, and gateway.

A timeout or connection failure does not prove that no session exists.
A fresh service assertion does not make another login attempt idempotent.

Service-assertion replay prevention and login duplicate prevention are
separate controls.

Member 4 reports that the gateway currently uses proxy_next_upstream off.
Isolated failure tests verified no upstream retries in the tested scenarios.
Real Auth integration verification remains pending.

BFF retry behavior remains owned by Member 1.

## Proposed bounded login-attempt contract

Status: PROPOSED — complete mechanism requires Members 1 and 4 review.

### Attempt identity and binding

The BFF generates an attempt identifier with at least 128 bits of
cryptographically secure randomness for each explicit login attempt.

Auth binds the attempt to:

- The authenticated BFF caller.
- The marketplace audience.
- The login operation.
- A validated server-issued pre-session context.
- The first submitted credential payload through a keyed fingerprint.

The BFF validates the pre-session context and its binding to the HttpOnly
context cookie and CSRF protection. Browser mutations require exact-Origin
validation.

A browser-supplied context identifier alone is insufficient.

The credential fingerprint covers the normalized email and exact password
using an unambiguous encoding and a dedicated runtime-provisioned HMAC key.

Never persist the plaintext password or an unkeyed password fingerprint.

Exact fingerprint encoding, key configuration, context transport, and
admission-proof format remain review items.

### Bounds and completion expiry

- Issuance eligibility expires five minutes after durable Auth admission.
- Check expiry before issuance writes and again immediately before the
  conditional update marking the attempt COMMITTED.
- Use PostgreSQL clock_timestamp(), which advances during a transaction.
  Do not use transaction-start time for the completion check.
- Equality with the deadline means expired.
- Failure of the final check rolls back session and refresh writes.
- This bounds the final eligibility check, not the time at which COMMIT
  finishes or its acknowledgement arrives.
- Metadata remains for twenty-four hours from admission. Cancellation,
  duplicate requests, and recovery do not extend that deadline.
- Recovery remains available after issuance expiry until metadata expiry.
  Issuance expiry does not establish that no session committed.
- After metadata expiry, deny recovery confirmation even if cleanup has
  not yet removed the row.
- Expired or cancelled attempt IDs cannot be admitted again.
- Admission requires an unexpired, one-time server-issued admission proof.
  Deleting metadata must never make that proof reusable.
- Unknown or cleaned-up attempts are never confirmed cancelled or reusable.
- Cleanup never substitutes for expiry checks.
- Admission and recovery require reviewed rate limits and storage limits.

Both deadlines must be persisted by Auth. The precise durable-admission
time definition must be specified before implementation; do not assume
transaction-start time equals commit time.

These are proposed bounds, not implemented guarantees.

### Duplicate handling and verification ownership

A database uniqueness constraint binds caller, operation, and attempt ID.

Admission initially reserves the attempt without a credential fingerprint.

The first login submission must atomically bind the fingerprint and claim
verification ownership before password verification starts.

Only that owner may proceed to issuance. An ADMITTED row alone does not
establish verification ownership.

Concurrent submissions cannot start another verification or create another
session. A different payload for the same attempt is rejected without
changing the original binding.

If the owning worker crashes, another worker must not take over and issue
credentials implicitly. Explicit recovery is required before a new attempt.

The claim representation and conditional database update remain
implementation design items.

### Atomic completion

The issuance transaction locks the attempt before the account.

It rechecks verification ownership, caller/context binding, state,
issuance expiry, account eligibility, and credential version.

Session creation, refresh-hash persistence, and the COMMITTED transition
share one transaction. Record the associated session ID on the attempt.

Signing occurs before commit. Return credentials only after confirmed commit.

A stale worker cannot commit after recovery has cancelled its attempt.

All failure and rejection transitions must be conditional on the expected
state and ownership. They must not overwrite a concurrent cancellation.

### No retained credential responses

This proposal retains no recoverable access or refresh credential response.

A duplicate after commit must not return AUTHENTICATED without credentials,
mint replacement credentials, or create another session.

Return an attempt-state error requiring explicit recovery.

Attempt-state responses require the original caller and validated context.
They never establish user authentication.

Only the successful original issuance operation returns the complete
credential envelope after confirmed commit.

### Explicit recovery and cancellation

Browser wording: "Cancel this sign-in attempt and start again."

Require:

- The original authenticated BFF identity.
- The validated original pre-session context.
- CSRF protection.
- Exact-Origin validation at the BFF.

The BFF must retain enough context to offer recovery throughout metadata
retention. Recovery-context expiry and renewal require Member 1 agreement.

Expired issuance eligibility alone must not disable recovery.

Attempt identifiers and state responses never establish authentication.

Admission must be durable before password verification begins.
Admission and cancellation must serialize correctly.

For an existing attempt, recovery locks its record:

- ADMITTED: mark CANCELLED, including while password verification runs.
- COMMITTED: revoke only its associated session and mark CANCELLED in
  the same transaction.
- REJECTED or EXPIRED: mark CANCELLED without creating a session.
- CANCELLED: confirm again only within retention and with matching binding.

A worker finishing verification must lock and recheck the attempt before
writing session state. Cancelled, expired, and terminal attempts cannot issue.

If recovery arrives before admission is visible, return ATTEMPT_UNRESOLVED.
Do not interpret a missing row as confirmed cancellation.

A subsequent explicit recovery request may resolve the attempt. It is a
recovery operation, not a replay of login or password verification.

Do not authorize a replacement attempt while cancellation is unresolved.

The admission protocol must prevent delayed original admission from creating
an attempt after confirmed cancellation. Existing-row-only recovery does
not by itself define a complete admission protocol.

Server-issued admission proof and its binding remain unresolved review items.

Missing or cleaned-up records return ATTEMPT_UNRESOLVED.
Never recreate them through recovery.

Only after confirmed cancellation may an explicit new attempt proceed.
Require fresh credential entry and verification. Retain no password for
recovery.

Preserve unrelated existing sessions and browser cookies. Recovery responses
must not install or clear authentication cookies.

If storage, locking, or commit outcome is uncertain, return AUTH_UNAVAILABLE
without claiming cancellation or rollback.

Revoking an associated session does not immediately invalidate offline
access tokens. Sensitive operations require authoritative state checks.

### Proposed durable states

| State | Meaning | Permitted next states |
|---|---|---|
| ADMITTED | Durable attempt; verification may be claimed | COMMITTED, REJECTED, EXPIRED, CANCELLED |
| COMMITTED | Session and refresh state committed atomically | CANCELLED |
| REJECTED | Credential or eligibility rejection; no issued session | CANCELLED |
| EXPIRED | Issuance deadline passed without committed issuance | CANCELLED |
| CANCELLED | Cancellation confirmed; associated session revoked if present | None |

Verification ownership is separate metadata within ADMITTED.

There is no durable ISSUING state. Issuance writes remain inside the
transaction while the attempt is locked.

COMMITTED becomes visible to other transactions only after commit.
Transport failures are observations, not durable states.

A final expiry failure rolls back issuance writes. A separate transaction
may mark ADMITTED as EXPIRED only after locking and confirming it remains
ADMITTED and is past its issuance deadline.

Persist and compare audience and context binding as well as the unique
caller, operation, and attempt identity.

Cleanup must coordinate with record locks and retention checks.
Terminal records cannot be reused.

### Proposed internal wire shapes

These are field-shape proposals, not implemented endpoint contracts.

Admission and recovery route paths require service-permission and
exact-routing review before registration.

Admission request:

```json
{
  "attemptId": "<128-bit-or-stronger random identifier>",
  "contextProof": "<server-issued bound proof>"
}
```

Admission response:

```json
{
  "status": "ADMITTED",
  "attemptId": "<identifier>",
  "issuanceExpiresAt": "<UTC timestamp>",
  "metadataExpiresAt": "<UTC timestamp>"
}
```

Login request:

```json
{
  "attemptId": "<identifier>",
  "contextProof": "<bound proof>",
  "email": "<email>",
  "password": "<exact password>"
}
```

Recovery request:

```json
{
  "attemptId": "<identifier>",
  "contextProof": "<original bound proof>"
}
```

Confirmed recovery response:

```json
{
  "status": "CANCELLED",
  "attemptId": "<identifier>"
}
```

Caller identity and audience come from service authentication, never these
JSON fields. Reject unexpected fields.

Admission-proof issuer, format, lifetime, attempt binding, one-time use,
and renewal behavior remain unresolved.

The contextProof placeholder does not yet define whether separate context
and admission proofs are required. Resolve that distinction before coding.

These shapes do not authorize admission implementation.

Only successful original issuance returns the complete credential envelope
from internal-auth-sessions-v1.md after confirmed commit.

Admission, duplicate, and recovery responses contain no account identity
or credentials. Every response requires no-store.

### Proposed attempt errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | INVALID_REQUEST | Invalid or unexpected fields |
| 409 | ATTEMPT_IN_PROGRESS | Attempt already claimed; no second issuance |
| 409 | ATTEMPT_CONFLICT | Bound request differs from the original |
| 409 | ATTEMPT_RECOVERY_REQUIRED | Attempt committed; credentials are not replayed |
| 409 | ATTEMPT_CANCELLED | Attempt cannot issue |
| 410 | ATTEMPT_EXPIRED | Known attempt is no longer eligible for issuance |
| 409 | ATTEMPT_UNRESOLVED | Cancellation or reusable state cannot be established |
| 503 | AUTH_UNAVAILABLE | Infrastructure failure or uncertain outcome |

These mappings require Members 1 and 4 review.

Existing service-authentication errors and INVALID_CREDENTIALS remain
separate. Unauthorized callers receive no attempt-state information.

Lookup and error precedence must distinguish issuance expiry from metadata
expiry. A committed attempt requires recovery even after issuance expiry;
metadata expiry prevents recovery confirmation.

Operational and attempt-state errors preserve existing browser cookies.

### Storage, keys, and recovery

Attempt records and fingerprints are Auth-owned and access-restricted.
They must not enter ordinary logs or general-purpose caches.

Fingerprint keys require dedicated runtime provisioning, versioning,
rotation, and bounded retention.

Unavailable required keys or storage deny the operation with an operational
error. Exact key-loss recovery behavior requires review.

Backup and restore procedures must prevent old attempts or sessions from
being revived as valid issuance state.

Storage limits, cleanup scheduling, retention enforcement, and restore
procedures require Member 4 review.

This proposal needs no credential-response encryption key because it retains
no recoverable credential responses.

### Conditional credential-retention requirements

No retained credential-response mechanism is approved or implemented.

If a later alternative requires retention, Member 4 requires:

- Explicit ownership of the credential store.
- Authenticated encryption.
- A dedicated, versioned runtime encryption key separate from signing
  and service-assertion keys.
- Binding to caller, operation, attempt, and expiry.
- Expiry checked on every retrieval independently of cleanup.
- Bounded retention and cleanup.
- Key rotation, key-loss recovery, and backup procedures.
- No plaintext credentials in logs, traces, backups, or general-purpose
  caches.
- Operational errors when storage or decryption is unavailable.

Member 4's earlier requirements specify Auth-owned retention. A BFF-owned
credential store would change that boundary and requires new approval.

### Browser delivery decision

Auth duplicate prevention does not solve browser cookie ordering.

An older HTTP response must not overwrite credentials from a newer attempt.
A generation check cannot prevent an already-sent Set-Cookie response from
arriving late.

Disabled submit buttons, browser locks, and coordination leases are not
sufficient guarantees across reloads, tabs, and delayed responses.

A stable opaque BFF context cookie with authoritative server-side credential
selection is an alternative proposal only.

It changes the existing browser contract and introduces BFF session storage
and recoverable credential retention.

Joint review must cover:

- Context bootstrap and concurrent bootstrap responses.
- Fixation prevention and authentication-boundary handling.
- Context expiry and renewal.
- Delayed responses and authoritative credential selection.
- Recovery, logout, and logout-all.
- Storage ownership, encryption, and runtime keys.
- Storage failures and backup recovery.

No stable-context solution is accepted here.
Cookie installation remains disconnected until a concrete protocol is
chosen and tested.

## Required verification

- Exact internal and safe browser response mappings.
- BFF identity, audience, operation, and context isolation.
- At most one verification owner and session per attempt.
- Credential payload mismatch handling.
- Password changes between verification and issuance.
- Eligibility and credential-version rechecks under account locking.
- Authentication-time persistence and fixed session deadlines.
- Five-minute issuance eligibility, including the final expiry check.
- Twenty-four-hour metadata retention and recovery boundaries.
- Cancellation during verification and issuance.
- Recovery before admission becomes visible.
- Durable rejection of late workers after cancellation.
- Unknown attempts after cleanup are not confirmed cancelled or reusable.
- Real PostgreSQL rollback on signing or refresh persistence failure.
- Uncertain commit acknowledgement resolved through durable attempt state.
- Recovery revokes only the associated session.
- No credentials replayed from duplicate or recovery responses.
- Delayed browser responses cannot replace newer credentials.
- Context bootstrap, recovery, logout, and multi-tab ordering.
- Operational errors preserve unrelated cookies.
- No-store and secret exclusion on every outcome.
- Gateway no-retry behavior against real Auth.
- Runtime key mounts and public-only JWKS publication.

## Refresh prerequisites

Do not advertise or invoke refresh before its lifecycle is implemented
and reviewed.

The following remain unresolved:

- Refresh credential format, entropy, hash representation, and schema.
- Atomic rotation and credential-family state.
- Concurrent refreshes across tabs and BFF replicas.
- Lost-response recovery and any bounded response retention.
- Reuse detection without an unrestricted grace period.
- Coordination with logout and audience-scoped logout-all.
- Prevention of stale credential installation.

## Remaining review decisions

Member 1:

- Context binding and recovery-context lifetime.
- Explicit recovery UX and fresh credential entry.
- Browser delivery protocol, bootstrap, delayed responses, and logout.
- Browser-safe error mapping.

Member 2:

- Admission-proof design and verification ownership.
- Exact state transitions, wire fields, error precedence, and route paths.
- Credential versioning and compatible transaction locking.
- Fingerprint encoding and concurrency tests.

Member 4:

- Storage and rate limits.
- Runtime keys, rotation, retention, and key-loss handling.
- Backup/restore and cleanup procedures.
- Gateway routing and real Auth retry verification.
- Any proposed change to credential-storage ownership.

## Integration status

Earlier acceptance covers the issuance direction only.

The complete login-attempt mechanism and stable BFF context alternative
are not accepted or implemented.

This document does not enable cookie installation, login issuance,
refresh, or live integration.