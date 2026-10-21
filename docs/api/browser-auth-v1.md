# Browser authentication contract

Status: DRAFT - not an implemented session API
Updated: 2026-10-21
Owner: Member 2
Reviewers: Members 1 and 4

## Implementation status

Implemented in Auth:
- POST /api/v1/auth/register
- POST /api/v1/auth/verify-email
- Internal CredentialsService; no credential-validation HTTP route.
- Database-backed readiness and shutdown cleanup.

Not implemented:
- Browser BFF integration, login, sessions, access/refresh issuance,
  rotation, logout, session checks, MFA and CSRF bootstrap.
- Verification issuance, resend and email delivery.
- Cache-Control: no-store enforcement across Auth and BFF.

Acceptance of this draft does not establish verified integration.

## Boundaries and routing

ALIGNED between Members 1 and 2:
Browser -> same-origin Next.js BFF -> gateway -> Auth.

Browser routes use /api/v1/auth.
Credential-bearing Auth operations are server-only and must not be
publicly reachable through a generic gateway proxy.

Member 1 owns browser cookies and BFF CSRF enforcement.
Member 2 owns identity, credentials, session policy and MFA.
Member 4 confirms gateway routing and BFF service authentication.

The authenticated BFF identity determines its permitted audience.
A browser-supplied audience or service name is not authoritative.
Service authentication and end-user authentication are separate checks.

| Application | Local origin | Planned production origin |
|---|---|---|
| Marketplace | http://localhost:3000 | https://gigzlk.com |
| Admin | http://localhost:3001 | https://admin.gigzlk.com |

Auth port 3006 is a local service address, not a browser API origin.

## Credentials and cookies

ALIGNED:
- No access/refresh credentials in browser-readable JSON, browser storage,
  URLs, logs, traces or analytics.
- Separate HttpOnly access and refresh cookies.
- Production cookies are Secure, host-only, Path=/ and SameSite=Lax.
- No Domain attribute or shared parent-domain authentication cookie.
- Distinct marketplace/admin names and backend-enforced audiences.
- Local HTTP uses distinct development names; Secure may be disabled locally.
- Localhost ports do not isolate cookies.
- Auth stores opaque refresh credentials hashed.
- All authentication responses, including errors, require
  Cache-Control: no-store at Auth and BFF.

Exact cookie names, internal credential transport and JWT/JWKS details
remain OPEN for Members 1, 2 and 4. BFF responses must use explicit
allowlisted fields rather than forwarding Auth response bodies.

## Session policy

ALIGNED draft defaults:
- Access lifetime: at most 10 minutes.
- Marketplace session: absolute maximum seven days from login.
- Admin session: absolute maximum eight hours; idle limit 30 minutes.
- Rotation never extends the original absolute deadline.
- Credential expiry must not exceed the session absolute deadline.
- Admin receives no full session until MFA succeeds.

OPEN: definition of qualifying admin activity and idle-deadline updates.

Ordinary marketplace access may remain usable until access expiry,
for at most 10 minutes after revocation. Admin and sensitive actions
must validate current session/account state and fail closed if unavailable.

Each domain owner must identify sensitive operations before integration.
Session checks do not replace resource-level authorization.

## Proposed browser endpoints

All routes below are PROPOSED except register and verify-email.

| Method and suffix under /api/v1/auth | Request | Browser result |
|---|---|---|
| GET /csrf | None | CSRF bootstrap response |
| POST /login | email, password | Authenticated or MFA-required state |
| POST /refresh | No credential in JSON | Updated cookies and safe session state |
| GET /session | None | Current safe session state |
| POST /logout | No account/session selector | Revoke current session |
| POST /logout-all | No audience/account selector | Revoke sessions for this app audience |
| POST /mfa/challenge | code or recoveryCode, exactly one | Complete pending challenge |
| POST /mfa/enrollment | Contract pending | Begin protected enrollment |
| POST /mfa/enrollment/confirm | code | Confirm enrollment |
| POST /mfa/recovery-codes/regenerate | Contract pending | Replace recovery codes |

Safe authenticated state is proposed as:
{ "status": "AUTHENTICATED", "accountId": "<UUID>",
  "audience": "marketplace", "sessionExpiresAt": "<UTC timestamp>" }

MFA-required browser state is proposed as:
{ "status": "MFA_REQUIRED", "methods": ["TOTP", "RECOVERY_CODE"] }

Challenge credentials remain in restricted HttpOnly cookies.
No full access or refresh credentials are issued before MFA completion.

Recovery codes are a separate, intentional one-time display secret:
never log, cache or persist them in frontend storage.

Server-only Auth route paths, headers and credential response schemas
remain OPEN. They require a separate explicit contract before coding.

## CSRF bootstrap proposal

PROPOSED for review:
- BFF issues a short-lived pre-session context and CSRF token through GET /csrf.
- Context is bound to the app audience and an HttpOnly host-only cookie.
- CSRF token is returned to same-origin JavaScript and kept in memory.
- Mutations require X-CSRF-Token plus exact configured Origin validation.
- Login, registration and verification use the pre-session context.
- After login, replace it with session-bound CSRF protection.
- Refresh must support CSRF validation when access has expired.
- GET never changes account or authentication state.
- Missing or unexpected Origin is rejected for browser mutations.
- No wildcard credentialed CORS.

CSRF tokens are not access/refresh credentials.
Cross-instance validation, token expiry, rotation and logout handling
remain OPEN. An allowed Origin is not service authentication.

## Refresh and revocation requirements

Transparent refresh remains disconnected until these are specified/tested:
- Atomic rotation and concurrent requests across BFF instances and tabs.
- Lost-response retry behavior.
- Reuse detection and revocation policy.
- Bounded retention of any encrypted retry response.
- Prevention of stale responses overwriting newer browser cookies.

No unrestricted reuse grace period is implied.
A network failure or operational 503 must not be treated as proof of
invalid credentials. Confirmed expired/revoked credentials clear cookies
and private caches, close authenticated sockets and redirect to login.

Refresh permits at most one retry of an original request after success.
Automatically replay only requests known to be safe or protected by an
agreed idempotency contract.

Logout-all is audience-scoped by default. Revoking both app audiences
requires a separate explicit security action and contract.

## MFA requirements

PROPOSED: TOTP and single-use recovery codes.

Pending-MFA credentials must have short expiry, attempt limits and scope
restricted to challenge completion. Auth must enforce admin authorization
independently of the UI.

Enrollment requires authenticated, recent identity proof and confirmation
before activation. Recovery codes are stored hashed and consumed atomically.
TOTP secrets require encryption and replay protection.

Reset/recovery must not become an MFA bypass. Identity-proof procedures,
session revocation, notifications and admin provisioning remain OPEN.
No deployed admin login is enabled before these controls are reviewed.

## Errors

Proposed new API errors use { code, message, requestId } with safe messages.

| HTTP | Proposed code | Meaning |
|---|---|---|
| 400 | INVALID_REQUEST | Invalid input |
| 401 | INVALID_CREDENTIALS | Login rejected without account-state disclosure |
| 401 | SESSION_INVALID | Expired, revoked or invalid session |
| 401 | MFA_CHALLENGE_INVALID | Invalid/expired challenge or proof |
| 403 | CSRF_REJECTED | CSRF or Origin validation failed |
| 403 | ACCESS_DENIED | Authenticated caller lacks authorization |
| 429 | RATE_LIMITED | Bounded retry delay |
| 503 | AUTH_UNAVAILABLE | Temporary operational failure |

These proposed envelopes do not change existing endpoints automatically.
Existing validation errors and credential-service exceptions retain their
current behavior until an explicit implementation change.

## Existing email verification contract

Frontend page: /verify-email
Fragment: #token=<64 lowercase hexadecimal characters>

Read fragment, immediately remove it using history replacement, retain
token only in page memory, and submit only after an explicit click.

POST /api/v1/auth/verify-email
Body: { "token": "<token>" }

- 200: { "status": "VERIFIED" }; clear token and show login link.
- 400 INVALID_VERIFICATION_TOKEN: clear token and show one safe message.
- Missing/malformed input: show invalid-link state without submitting.
- Network/503 EMAIL_VERIFICATION_UNAVAILABLE: explicit retry is allowed.
- No automatic login, automatic submission or third-party analytics.
- Reload after fragment removal requires reopening the original email link.

Expired, consumed, unknown and otherwise unusable tokens share one response.
No distinct already-used or expired response is promised.

## Review and implementation gates

Before live integration:
1. Members 1/2 review browser schemas, CSRF and cookie contract.
2. Member 4 confirms private routing and service authentication.
3. Define server-only credential schemas, signing/key discovery and rotation.
4. Specify refresh concurrency and session-revocation checks.
5. Define MFA enrollment, recovery/reset and provisioning contracts.
6. Implement no-store and test success/error headers at both boundaries.
7. Test audience isolation, CSRF, refresh races, logout and failure handling.

Notification coordination remains separate. Issuance/outbox, resend,
transparent refresh and live frontend integration remain disconnected.
