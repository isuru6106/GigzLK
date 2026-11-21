# Internal Auth session API

Status: PROPOSED - no endpoints in this document are implemented
Updated: 2026-10-21
Owner: Member 2
Reviewers: Members 1 and 4

Companion: [Browser authentication contract](browser-auth-v1.md).

## Trust boundary

These endpoints are private server-to-server operations under
/internal/v1/auth. They must not be exposed by a public gateway route.

Every operation requires an authenticated, authorized service identity.
Marketplace and admin BFF identities have separate allowed audiences.
Auth derives the audience from that identity, not browser input.

Member 4 must confirm the service-authentication mechanism, credential
transport, gateway routing, TLS and rotation before implementation.

An end-user credential never substitutes for service authentication.
Service authentication alone never authorizes access to a user's session.

BFFs strip browser-supplied internal identity headers and use explicit
request/response mappings. They never proxy arbitrary Auth paths.

All responses, including errors, require Cache-Control: no-store.
Request bodies, credentials, cookies and MFA secrets must be redacted
from logs, traces, analytics and error reporting.

The existing /api/v1/auth no-store middleware does not cover these
proposed /internal/v1/auth routes; coverage must be added when implemented.

## Proposed operations

| Method and suffix | Required user proof | Purpose |
|---|---|---|
| POST /login | email and password | Begin a new session or MFA challenge |
| POST /refresh | refreshToken | Rotate credentials for an existing session |
| POST /session/check | accessToken | Validate token and current session/account state |
| POST /logout | refreshToken | Revoke the associated session |
| POST /logout-all | accessToken and recent authentication | Revoke this account's sessions for the caller audience |
| POST /mfa/challenge | challengeToken and one MFA proof | Complete a pending login |

No caller-provided accountId or sessionId selects the target of logout,
logout-all or MFA completion. Auth derives identity from validated proof.

POST /session/check is an internal proof-validation operation. Its browser
counterpart remains GET /api/v1/auth/session; no token is placed in a URL.

## Login

Proposed request:
{ "email": "worker@example.com", "password": "<exact password>" }

Use registration-compatible email normalization and exact password
verification. Only ACTIVE, email-verified accounts can proceed.

Unknown accounts, wrong passwords and ineligible account states share
401 INVALID_CREDENTIALS. Admin authorization is checked separately;
valid marketplace credentials do not grant admin access.

Successful marketplace login returns HTTP 200 to the BFF:
{
  "status": "AUTHENTICATED",
  "accountId": "<UUID>",
  "sessionId": "<UUID>",
  "audience": "marketplace",
  "accessToken": "<credential>",
  "accessExpiresAt": "<UTC timestamp>",
  "refreshToken": "<opaque credential>",
  "sessionExpiresAt": "<UTC timestamp>"
}

This body is server-only. The BFF sets cookies and returns only the
allowlisted safe browser state defined in the companion document.
Auth does not set browser-domain cookies on internal responses.

Admin login returns HTTP 200 with:
{
  "status": "MFA_REQUIRED",
  "challengeToken": "<restricted credential>",
  "challengeExpiresAt": "<UTC timestamp>",
  "methods": ["TOTP", "RECOVERY_CODE"]
}

No full access/refresh credentials are returned before MFA succeeds.
Admin accounts without completed enrollment cannot bypass MFA.
Provisioning/enrollment behavior remains OPEN and blocks admin rollout.

Uncertain login responses must not be automatically retried until a
bounded login-idempotency policy is specified. A timeout does not prove
that no session was created.

## Refresh

Proposed request:
{ "refreshToken": "<opaque credential>" }

Success returns the authenticated server-only envelope above with rotated
credentials and the unchanged session absolute deadline.

Validate caller audience, credential hash, account status, revocation,
absolute deadline and applicable idle deadline before rotation.
Rotation must be atomic and must not revive a revoked session.

The following are OPEN and block refresh implementation/integration:
- Caller/session-scoped operation identifiers and payload binding.
- Simultaneous refreshes across tabs and BFF replicas.
- Lost-response retries and bounded encrypted response retention.
- Reuse detection versus legitimate duplicate requests.
- Atomic coordination with logout and logout-all.
- Prevention of stale responses overwriting newer cookies.

Do not introduce an unrestricted reuse grace period.
Do not implement a refresh worker or transparent browser retry from this
draft alone. Never blindly replay a state-changing business request.

## Current-state checks

Proposed request:
{ "accessToken": "<credential>" }

Validate signature/issuer/audience/expiry plus current session/account
state. Success returns HTTP 200:
{
  "status": "ACTIVE",
  "accountId": "<UUID>",
  "sessionId": "<UUID>",
  "audience": "<caller-permitted audience>",
  "sessionExpiresAt": "<UTC timestamp>",
  "authenticationMethods": ["PASSWORD"]
}

Admin checks require proof that MFA was completed.
The precise claim vocabulary is OPEN pending the signing/token contract.

Invalid proof or inactive state returns 401 SESSION_INVALID.
Unavailable authoritative state returns 503 AUTH_UNAVAILABLE.
Consumers must deny admin/sensitive operations during that failure.

Ordinary marketplace JWT verification may permit access until token expiry,
for at most ten minutes after revocation. It must not be described as an
immediate revocation check.

Domain services still enforce current permissions and resource ownership.
Sensitive authorization must define race handling for changes occurring
between the state check and the business operation.

## Logout

Proposed request:
{ "refreshToken": "<credential>" }

HTTP 204 confirms that the valid associated session has been revoked,
or that it was already revoked. Invalid/unknown proof may also return
204 without revealing whether a session exists.

Auth must verify the credential and audience before revoking anything.
Durable consumed-token hashes may be needed to support logout after rotation;
the retention and lookup rules remain OPEN.

A storage failure returns 503, not a false revocation success.
The BFF may clear local cookies on failure but must not claim server
revocation was confirmed. Session credentials must not enter a retry log.

## Logout-all

Proposed request:
{ "accessToken": "<credential>" }

Requires current-state validation and recent authentication.
The recent-authentication proof, lifetime and MFA requirements are OPEN.

HTTP 204 confirms durable revocation of the account's sessions for the
authenticated BFF audience. Other audiences are unaffected.

Concurrent login/refresh ordering must be specified and tested, using a
durable account/audience revocation mechanism or equivalent.
A separate both-audience security action requires its own contract.

## MFA challenge

Proposed request contains challengeToken and exactly one of:
- code: TOTP proof.
- recoveryCode: recovery proof.

Challenge lifetime: proposed five minutes, with bounded attempts and
rate limits. Exact limits require review.

The challenge is bound to account, caller audience and login attempt.
Consume it atomically when issuing the session. A challenge is not a
general access credential.

Recovery codes are single-use and stored hashed.
TOTP secrets require encryption and replay prevention.
Repeated or uncertain completion must not issue uncontrolled sessions;
completion-idempotency rules remain OPEN.

Enrollment, enrollment confirmation, recovery-code regeneration and
MFA reset require a separate contract covering recent identity proof,
one-time secret display, notifications, revocation and recovery abuse.
No deployed admin access is enabled before those flows are reviewed.

## Session deadlines

Aligned draft defaults:
- Access: at most ten minutes.
- Marketplace: seven-day absolute maximum from successful login.
- Admin: eight-hour absolute maximum and 30-minute idle limit.
- Rotation cannot extend the absolute maximum.
- Access expiry cannot exceed the applicable session deadline.

For admin, idle-deadline enforcement and token expiry must be coordinated.
Background refresh/polling must not silently count as user activity.
Qualifying activity and atomic idle updates remain OPEN.

## Error contract

Proposed envelope: { "code": "<code>", "message": "<safe text>",
"requestId": "<server-generated or validated correlation ID>" }.

| HTTP | Code | Meaning |
|---|---|---|
| 400 | INVALID_REQUEST | Malformed or unexpected fields |
| 401 | SERVICE_AUTH_INVALID | Missing/invalid service authentication |
| 401 | INVALID_CREDENTIALS | Generic login rejection |
| 401 | SESSION_INVALID | Invalid, expired or revoked user proof |
| 401 | MFA_CHALLENGE_INVALID | Invalid challenge or MFA proof |
| 403 | SERVICE_ACCESS_DENIED | Service lacks operation/audience permission |
| 403 | ACCESS_DENIED | User lacks required authorization |
| 429 | RATE_LIMITED | Retry delay supplied safely |
| 503 | AUTH_UNAVAILABLE | Operational failure; authentication not established |

The BFF must distinguish service-authentication failures from user-session
failures. Service failures must not be presented as wrong passwords or
automatically erase otherwise valid user sessions.

Never expose hashes, raw provider/database errors or submitted secrets.
Error envelopes do not automatically replace existing public API behavior.

## Review gates

Before implementation:
1. Member 4 confirms service identity, routing and credential transport.
2. Members 1/2 approve browser-to-internal mappings and cookie names.
3. Specify access signing, issuer, audiences, key discovery and rotation.
4. Resolve refresh/login/MFA completion retry and concurrency semantics.
5. Define session storage, revocation ordering and sensitive-action checks.
6. Complete MFA provisioning/enrollment/recovery/reset contracts.
7. Test no-store, secret redaction, audience isolation and failure handling.

This draft does not enable live integration, transparent refresh,
verification resend or Notification delivery.
