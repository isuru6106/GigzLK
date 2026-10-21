# Auth platform contract

Status: PROPOSED - not implemented or approved for live integration
Updated: 2026-10-21
Owner: Member 4
Reviewers: Members 1 and 2

Companion contracts:
- [Browser authentication](../api/browser-auth-v1.md)
- [Internal Auth sessions](../api/internal-auth-sessions-v1.md)

## 1. Implementation boundary

The reviewed snapshot contains Auth registration, email verification,
an internal CredentialsService and no-store middleware for /api/v1/auth.

Shared Compose contains PostgreSQL, Redis, Kafka and ML.
Auth, gateway and BFF integration are not configured there.

This document proposes routing, BFF service authentication, credential
transport and key handling. It does not implement login or sessions.

## 2. Routing

Propose NGINX with separate public and private listeners.

- Public listeners reject /internal and /internal/*.
- Browser authentication requests terminate at the same-origin BFF.
- BFFs construct explicit internal requests rather than proxying arbitrary paths.
- Private gateway routes allow only explicitly configured methods and paths.
- Auth independently validates service identity and operation permission.
- Network access, Origin and forwarded identity headers establish no trust.
- Auth has no published host port in the integrated Compose profile.

Initial private route candidates are POST operations under /internal/v1/auth:
- /login
- /refresh
- /session/check
- /logout
- /logout-all
- /mfa/challenge

Unlisted routes and methods are denied.
Future enrollment and recovery routes require explicit contract updates.

## 3. Service assertion profile

This is an application-specific signed JWT profile.
It is not an OAuth token endpoint or end-user access-token format.

Each BFF signs its own assertions using its separately provisioned key.
Auth receives only the corresponding public verification keys.

Protected header:
- alg: RS256 only.
- typ: gigzlk-service-assertion+jwt.
- kid: required identifier from the configured issuer-specific key set.
- RSA keys: at least 2048 bits.
- Embedded keys and token-supplied discovery URLs are rejected.
- Unsupported critical headers are rejected.

Required claims:
- iss: configured BFF issuer.
- sub: configured BFF identity.
- aud: exactly the configured Auth-service audience, as a single string.
- iat: issued-at time, integer NumericDate.
- exp: expiry time, integer NumericDate.
- jti: cryptographically random identifier with at least 128 bits of entropy.

Local proposed mapping:

| iss | sub | Derived session audience |
|---|---|---|
| urn:gigzlk:local:bff:marketplace | marketplace-bff | marketplace |
| urn:gigzlk:local:bff:admin | admin-bff | admin |

Local service assertion aud:
urn:gigzlk:local:auth-internal

Production and staging use separate configured issuers, audiences and keys.
Their exact values require agreement before deployment.

Validation:
- Verify signature with the configured issuer/kid key.
- Enforce the exact algorithm and token type.
- Validate the configured iss/sub pair and Auth-service audience.
- Require 0 < exp - iat <= 60 seconds.
- Allow at most five seconds of clock skew.
- Reject iat more than five seconds in the future.
- Reject assertions older than 65 seconds.
- Reject when current time is at or after exp + five seconds.
- Reject malformed claims, duplicate JSON member names and oversized tokens.

Assertions contain no passwords, user tokens or MFA proof.

The service assertion aud does not select the user-session audience.
Auth derives that audience exclusively from the verified service identity.
Caller-provided roles, scopes or audiences cannot expand configured permissions.

## 4. Operation authorization

Proposed initial service permissions:

| Service | Permitted suffixes |
|---|---|
| marketplace-bff | /login, /refresh, /session/check, /logout, /logout-all |
| admin-bff | Above operations plus /mfa/challenge |

Marketplace MFA operations require a later explicit agreement.

Service permission does not replace user proof, current-state checks,
admin authorization, MFA or resource-level authorization.

## 5. Replay protection

Propose durable replay records in Auth-owned PostgreSQL.

Member 2 owns the schema and migration.
Do not use the current non-persistent Redis configuration for this purpose.

- Validate signature, claims and operation permission first.
- Atomically insert a record unique on (issuer, jti).
- Commit consumption before executing the protected operation.
- Duplicate insertion rejects the assertion.
- Retain the record until after exp plus allowed clock skew.
- All Auth replicas use the same authoritative replay store.
- Do not store the raw assertion or end-user credentials.

A crash after consumption may leave the business outcome uncertain.
Assertion consumption does not establish business-operation idempotency.

An unavailable replay store returns 503 and permits no protected operation.

## 6. Retry rules

Generate a fresh assertion with a new jti for every outbound attempt.

Disable automatic gateway retries for credential-bearing operations.
A fresh assertion does not make an unsafe business retry safe.

Login, refresh and MFA completion must not be automatically retried
until their operation-specific idempotency contracts are approved.

An uncertain response does not prove the operation failed.
Do not automatically replay a business request after authentication refresh.

## 7. Credential transport and logging

BFF service authentication:
Authorization: Bearer <service-assertion>

End-user proof:
The explicit JSON fields defined in the internal Auth contract.

BFFs do not forward browser Authorization, Cookie or internal identity
headers to Auth. Each request is constructed from allowlisted fields.

Internal credential responses remain server-only.
Browser responses contain only allowlisted safe fields.

Disable credential-body capture and redact Authorization, Cookie,
Set-Cookie, passwords, tokens, MFA proof and encryption material across
BFF, gateway, Auth, tracing and error reporting.

All authentication responses, including gateway errors, require
Cache-Control: no-store.

Extend Auth middleware explicitly to future /internal/v1/auth routes.
Test no-store independently at every boundary.

## 8. Key provisioning and rotation

Service assertion keys:
- Each BFF receives only its own private signing key.
- Auth receives an issuer-specific public-key configuration.
- Provision these keys independently of end-user login.
- Do not fetch verification URLs supplied by assertions.
- Missing or invalid required configuration prevents readiness.

Proposed local injection:
Read-only Compose secret files, excluded from Git and image builds.
Compose file secrets are mounts, not an encrypted secrets vault.

Planned service-key rotation:
1. Distribute the new public key to every Auth replica.
2. Verify readiness and acceptance before changing BFF signing keys.
3. Switch the BFF to the new kid.
4. Stop signing with the old key.
5. Retain old verification for at least 120 seconds after its last use.
6. Remove the old key after the overlap and verification checks.

Compromise handling removes trust promptly rather than waiting for overlap.
The mechanism for consistent emergency removal across replicas remains open.

Auth access-token signing keys are separate.
Only Auth receives their private material.

Encryption keys are separate from signing keys.
Encrypted records identify their key version.
Retain old decryption keys until data is re-encrypted or safely deleted.

Production secret storage, rotation automation and recovery procedures
remain open.

## 9. Access JWT issuer and JWKS

Auth owns end-user access-token issuance and claim policy.

Proposed local user-token issuer:
urn:gigzlk:local:auth

Proposed user-token audiences:
- marketplace
- admin

These are distinct from urn:gigzlk:local:auth-internal.

Propose public verification keys at /.well-known/jwks.json through an
explicit gateway route. This is a public-key-only discovery exception;
it exposes no private keys or credential operations.

Exact production issuer and configured discovery URL require agreement.
Consumers must not discover keys from token-supplied URLs.

Before issuance, Members 2/4 must specify the signing algorithm,
claim vocabulary, bounded JWKS caching, unknown-kid behavior and rotation.
An unknown key never permits an unverified token.

## 10. TLS and local addresses

Proposed addresses:

| Component | Address |
|---|---|
| Marketplace | http://localhost:3000 |
| Admin | http://localhost:3001 |
| Public development gateway | http://localhost:8080 |
| Private gateway inside Compose | https://gateway:8443 |
| Auth inside Compose | auth:3006 |

Use a local development CA to issue the private gateway certificate.
Its SANs include gateway and localhost; include 127.0.0.1 only if used.

Each BFF trusts the development CA certificate and validates the
certificate chain, hostname and validity period.

For Node-based local BFFs, configure NODE_EXTRA_CA_CERTS before starting
the process, or configure an explicitly trusted HTTP client.

Never disable TLS certificate verification.
Do not put the CA private key in BFF containers.

Windows-hosted BFF development may use an explicit loopback mapping:
127.0.0.1:8443 to the private gateway listener.

Gateway-to-Auth HTTP is permitted only within isolated local development.
Outside that environment, require verified TLS on that hop too.
Its termination and certificate provisioning require implementation review.

## 11. Failure handling

| Condition | Result |
|---|---|
| Malformed, expired, bad signature, wrong issuer/audience/type or replay | 401 SERVICE_AUTH_INVALID |
| Unknown kid against a ready authoritative key configuration | 401 SERVICE_AUTH_INVALID |
| Valid service identity lacks operation permission | 403 SERVICE_ACCESS_DENIED |
| Required key configuration unavailable or replay storage unavailable | 503 AUTH_UNAVAILABLE |
| Gateway cannot establish its upstream connection | Safe 502/503/504 operational failure |

Private-listener denial may occur before an Auth JSON response exists.
BFFs must safely handle non-JSON gateway failures.

Auth distinguishes a PostgreSQL uniqueness conflict from a database outage.
Only the conflict establishes replay.

No infrastructure failure is treated as valid authentication.
No service-authentication failure is presented as a wrong user password.
These failures do not automatically erase otherwise valid browser sessions.

TLS validation failures stop the request and produce an operational
failure at the BFF; there is no insecure fallback.

## 12. Review and verification gates

Member 1:
- Review server-only assertion generation in both Next.js deployments.
- Verify runtime key access and development CA trust.
- Prevent signing keys from entering client bundles or NEXT_PUBLIC variables.
- Review safe retries and response/cookie mapping.

Member 2:
- Review assertion validation, permissions and replay schema.
- Review error mapping, user-token claims and internal no-store coverage.
- Keep session concurrency and MFA contracts explicit.

Member 4:
- Implement gateway, network restrictions and secret/certificate mounts.
- Verify routing, TLS, redaction and failure handling.

Required tests include:
- Public internal-route denial and private operation allowlists.
- Cross-BFF audience isolation.
- Invalid signatures, expiry, algorithm/type confusion and unknown keys.
- Concurrent replay across Auth replicas.
- Key/replay infrastructure failures.
- Key rotation and removal.
- Untrusted CA, wrong hostname and expired TLS certificates.
- Secret exclusion from logs, traces and browser bundles.
- No-store on success and error responses.

Live integration remains disconnected until review and relevant tests pass.
