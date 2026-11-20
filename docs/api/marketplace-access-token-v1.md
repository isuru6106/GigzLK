# Marketplace access-token contract

Status: PROPOSED — not implemented or approved for live integration
Owner: Member 2
Reviewers: Members 1 and 4

Companion documents:
- [Browser authentication](browser-auth-v1.md)
- [Internal Auth sessions](internal-auth-sessions-v1.md)
- [Auth platform](../architecture/auth-platform-v1.md)

## Scope and current implementation

Auth has marketplace session storage and an internal session-creation
service. These do not yet issue access or refresh credentials.

This document proposes marketplace access-token issuance, validation,
public-key discovery and rotation.

Admin tokens, MFA credentials and refresh rotation require separate
contracts. Live integration remains disconnected.

## Trust boundaries

Auth alone signs end-user access tokens.

Access-token signing keys are separate from BFF service-assertion keys
and encryption keys. Private signing material remains server-side in Auth.

A service assertion never substitutes for an end-user access token.
An end-user access token never substitutes for BFF service authentication.

The authenticated BFF identity determines the permitted session audience.
Browser input cannot select or expand that audience.

## Protected header

Require exactly these fields:

- alg: RS256.
- typ: at+jwt.
- kid: configured access-signing key identifier.

RSA keys must have a modulus of at least 2048 bits.

kid must match:
^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$

Reject unsupported headers, embedded keys, token-supplied discovery URLs,
critical extensions and duplicate JSON member names.

## Required claims

| Claim | Meaning and validation |
|---|---|
| iss | Exact configured Auth issuer |
| sub | Account UUID |
| aud | Exact string marketplace; arrays are rejected |
| sid | AuthSession UUID |
| jti | 32 lowercase hexadecimal characters from 16 random bytes |
| iat | Non-negative, safe integer NumericDate |
| exp | Non-negative, safe integer NumericDate |
| auth_time | Time password authentication succeeded, as an integer NumericDate |
| amr | Exactly ["pwd"] for this initial password-authenticated profile |

Local issuer:
urn:gigzlk:local:auth

Staging and production require separate configured issuers and keys.
Their values must be recorded before deployment.

Tokens contain no email, password, refresh credential or MFA secret.
They contain no roles or permissions in this initial profile.

Consumers must not infer resource permissions from account identity alone.

## Timing

Use UTC integer seconds.

At issuance:
- iat is the current time rounded down to whole seconds.
- exp is the earlier of iat + 600 and the session deadline rounded down.
- Refuse issuance when exp is not greater than iat.
- auth_time records the actual successful password-authentication time.
- A future refresh must preserve auth_time.

At validation:
- Require 0 < exp - iat <= 600.
- Require auth_time <= iat.
- Reject iat more than five seconds ahead of validator time.
- Reject when validator time is at or after exp.
- No expiry leeway is added in this profile.

The five-second future-issued-at allowance does not extend token expiry.
Clock synchronization remains a deployment prerequisite.

## Issuance and session state

Issue only for an ACTIVE, email-verified account and an eligible,
unrevoked MARKETPLACE session owned by that account.

Session creation, credential issuance and failure recovery need an
explicit implementation design before the login endpoint is enabled.
A session ID alone is never an authentication credential.

Do not return a successful login envelope unless all required credentials
are available. Define how signing failures affect persisted sessions.

A marketplace session has an absolute seven-day maximum.
Token issuance or future rotation must not move that deadline.

## Validation boundaries

Ordinary marketplace consumers validate signature, issuer, audience,
type, claim types and timing using configured trusted keys.

This validates the signed credential; it does not prove current account,
session or permission state.

Admin and sensitive operations require authoritative current-state checks.
The domain owner remains responsible for resource authorization.

For current-state checks, Auth must also confirm:
- sid exists and belongs to sub.
- Session audience is MARKETPLACE.
- Session is unrevoked and before its absolute expiry.
- Account remains ACTIVE and email-verified.
- Token expiry does not exceed the stored session deadline.

State-store failures deny the protected operation with an operational
error, rather than reporting successful authentication.

Ordinary offline validation can continue to accept an existing token
until its expiry after revocation. It does not offer immediate revocation.

## Input limits

Proposed limits:
- Compact JWT: 4096 ASCII bytes.
- Decoded protected header: 512 bytes.
- Decoded payload: 2048 bytes.
- Exactly three non-empty, canonical, unpadded base64url segments.
- Header and payload must be valid UTF-8 JSON objects.
- Reject duplicate member names and malformed encoding.

Validate bounds before parsing or performing cryptographic work.

Service-assertion and access-token validators must enforce their own
distinct token types, issuers, audiences and claim policies.

## JWKS discovery

Proposed public route:
GET /.well-known/jwks.json

It returns public verification keys only.

Each published JWK contains:
- kty: RSA
- use: sig
- alg: RS256
- kid
- n
- e

Never publish private RSA parameters.

Consumers use an explicitly configured discovery URL and issuer mapping.
They never follow a URL supplied by a token.

JWKS retrieval must validate the expected response structure, key type,
key strength, unique key identifiers and bounded response size.

The gateway route and deployment discovery URL remain to be implemented.

## JWKS caching and unknown keys

Proposed defaults:
- Successful JWKS response: Cache-Control: public, max-age=60.
- Maximum use of a last successfully validated key set: 300 seconds.
- Once that freshness limit is exceeded, refresh successfully or fail closed.
- Coalesce simultaneous refreshes within each consumer instance.
- Unknown kid may trigger one refresh, rate-limited to once per 30 seconds
  per configured issuer and consumer instance.
- Never accept a token with an unknown or unverified key.

A successful authoritative refresh that lacks the requested kid establishes
invalid proof. A failed refresh without a usable trusted key is an
operational failure.

JWKS is a public-key discovery exception to credential-response no-store.
It contains no user credentials or session data.

## Planned key rotation

1. Publish the new public key before using its private key.
2. Allow at least five minutes for consumers to refresh their key sets.
3. Verify discovery and validation before changing the active signing kid.
4. Stop signing with the previous key.
5. Retain its public key for at least twenty minutes after its last issuance.
6. Remove it only after the overlap and verification checks complete.

All Auth replicas must use coordinated signing and verification configuration.
Initial rotation uses a controlled rollout; runtime reload is not assumed.

Compromise requires prompt key removal and a separate emergency procedure.
Cached keys mean removal is not necessarily immediate at every consumer.
Do not claim immediate emergency revocation without additional controls.

## Credential handling and failures

Access credentials stay in server-only internal responses and HttpOnly
browser cookies managed by the BFF.

Never place credentials in URLs, browser-readable response bodies,
persistent browser storage, logs, traces or analytics.

Credential-bearing responses require Cache-Control: no-store.

For Auth current-state operations:
- Invalid user proof: 401 SESSION_INVALID.
- Unavailable authoritative state or required key infrastructure:
  503 AUTH_UNAVAILABLE.

Keep service-authentication failures distinct from user-proof failures.
Operational errors must not automatically clear otherwise valid sessions.

## Required verification

Before integration, test:
- Valid tokens and altered signatures.
- Wrong issuer, audience, algorithm and token type.
- Service/access-token substitution.
- Unknown and retired keys.
- Missing, malformed and duplicate claims.
- Input-size and exact expiry boundaries.
- Session-deadline truncation.
- Account/session mismatch, revocation and disabled accounts.
- State-store and signing failures.
- JWKS cache expiry, outages, refresh limits and rotation.
- Private-key exclusion from JWKS, images and browser bundles.

Refresh, logout-all ordering, CSRF and admin MFA retain their separate
review and implementation gates.


## Member 1 review clarifications

Member 1 accepts this draft from the frontend/BFF architecture perspective.
Implementation and integration verification remain pending.
Member 4 supports the design subject to the platform clarifications below.
Concrete retrieval limits await confirmation.

### JWKS freshness

Measure the 300-second freshness maximum from the last successful,
validated retrieval. Failed or suppressed refreshes never reset it.

Known keys may remain usable within that bound.
Unknown keys are never accepted.

If refresh is suppressed by the rate limit and the current key set lacks
the requested kid, deny the operation with 503 AUTH_UNAVAILABLE.
This does not establish an invalid user session and must not clear cookies.

A successful authoritative refresh that still lacks the requested kid
returns 401 SESSION_INVALID.

### BFF verification ownership

GET /api/v1/auth/session calls Auth's current-state endpoint.

Admin and sensitive operations require authoritative current-state
validation and fail closed when it is unavailable.

Ordinary marketplace requests may use local JWT validation only where
explicitly documented and reviewed. Local validation checks the full
token profile; it does not establish current session state or resource
permissions. Decoded claims alone never establish authentication.

Login and MFA responses use explicit server-only response mapping.
Logout and future refresh follow their operation-specific Auth contracts.
Expired access credentials alone must not block those flows.

Local validation remains disconnected pending implementation and route review.
Access expiry does not imply an implemented refresh capability.

Operational failures preserve otherwise valid session cookies.
Access issuance, refresh and live integration remain pending.

## Member 4 platform review clarifications

Member 4 supports the design subject to recording these details.
Deployment verification and live integration remain pending.

### Signing-key provisioning

Inject Auth private signing keys at runtime through read-only secret mounts.
Exclude them from Git, image layers and build arguments.

Configure the active signing kid explicitly.
Validate that its public key matches the private signing key before enabling
issuance. Invalid required configuration prevents issuance readiness.

### Discovery routing and transport

Expose only the exact GET /.well-known/jwks.json discovery route.
This exception must not expose internal Auth operations.

Consumers use a configured discovery URL, validate TLS certificates and
hostnames, and disable redirect following.

### Proposed retrieval bounds

The following concrete limits await Member 4's confirmation:
- Maximum response body: 32768 bytes, enforced while reading.
- Maximum keys: 8.
- Total retrieval deadline: 3 seconds, including connection and body reading.
- Redirect following: disabled.

Enforce the body limit regardless of Content-Length.
Request identity encoding and reject unexpected content encoding.

Oversized, timed-out, malformed or otherwise invalid responses must not
replace the last validated key set or reset its freshness timestamp.

### Coordinated rotation and emergency removal

Coordinate publication and signing changes across every Auth replica.
Measure old-key retention from its last issuance on any replica.

Document emergency key removal separately, including consumer cache
invalidation or disabling affected operations where necessary.
Do not claim immediate removal while consumers can still trust cached keys.

Member 1's accepted freshness and BFF validation clarifications also apply.
Access-token issuance, refresh and live integration remain pending.

### Accepted retrieval bounds

Accepted by Member 4 for the draft contract:
- Maximum response body: 32768 bytes, enforced while reading.
- Maximum published keys: 8, with unique kid values.
- Three-second total deadline covering connection, TLS, response reading
  and validation.
- Redirect following disabled.
- Request identity encoding; reject non-identity content encoding.

Invalid retrievals preserve the previous validated key set and its
original freshness timestamp. It remains usable only within the
300-second freshness limit. Unknown keys are never accepted.

Required boundary tests:
- 32768-byte body accepted; 32769-byte body rejected.
- Eight valid keys accepted; nine keys or duplicate kids rejected.
- Retrieval and validation must finish before the three-second deadline.
- Redirects and non-identity content encoding rejected.
- Failed retrievals do not replace keys or reset freshness.
- Known keys rejected once freshness reaches 300 seconds.
- Unknown keys never accepted, including during refresh suppression.

Contract acceptance does not establish implementation or verified integration.