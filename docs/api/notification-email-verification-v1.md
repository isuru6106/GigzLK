# Notification Email Verification v1

Status: DRAFT — local implementation in progress.
Owner: Member 3.
Reviewers: Members 1, 2 and 4.

Auth issuance, real email delivery and live integration remain disconnected.

## Ownership

Auth generates tokens, stores only token hashes, checks expiry,
consumes tokens and activates accounts.

Notification owns templates, delivery jobs, provider integration,
delivery retries and temporary delivery-payload cleanup.

Notification never verifies tokens or activates accounts.

## Internal endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | /internal/v1/notifications/email-verification | Submit a delivery request |
| GET | /internal/v1/notifications/by-request/{requestId} | Recover a submission result |
| GET | /internal/v1/notifications/{notificationId} | Read delivery status |
| POST | /internal/v1/notifications/{notificationId}/cancel | Request cancellation |

Every operation requires an authenticated service caller.
Records and request IDs are scoped to that caller.
Unknown and other-caller records return the same safe 404.

Service credentials, permissions and rotation remain pending Member 4.
Browser JWTs are not accepted as service credentials.

## Submission

Required fields:

- requestId: UUID, equal to the Idempotency-Key header.
- recipientEmail: one recipient address.
- verificationUrl: complete URL built from trusted Auth configuration.
- expiresAt: UTC timestamp.
- templateId: email-verification-v1.

Reject unexpected fields.

The frontend URL origin, path and fragment format remain pending
Member 1. Production URL validation must not be enabled using
unreviewed defaults.

Local tests use synthetic addresses and links only.

## Acceptance and idempotency

202 means the request and encrypted delivery payload are durably stored.
It does not mean an email was sent or received.

An identical retry returns 200 with the existing record.
Different validated content under the same caller-scoped request ID
returns 409.

Compare validated fields consistently using a keyed fingerprint.
Retain the fingerprint key identifier across key rotation.

Check existing records before applying the submission cutoff.
At or after expiresAt minus two minutes, do not create a new job.
An identical retry may retrieve its existing result.

Lookup by caller-scoped requestId supports recovery when Auth loses
the submission response before learning notificationId.

## Response metadata

Submission, lookup and cancellation responses contain only:

- notificationId
- requestId
- status
- deliveryOutcome
- expiresAt
- attempts
- cancellationRequested

Never return recipient addresses, verification links, tokens,
credentials or raw provider errors.

## Delivery states

| Status | Meaning |
|---|---|
| QUEUED | Accepted and awaiting an attempt |
| SENDING | An attempt has been claimed |
| RETRY_WAIT | A confirmed retryable failure awaits retry |
| SENT | Delivery provider or local sink accepted the message |
| FAILED | Terminal confirmed failure |
| CANCELLED | Cancelled before an uncertain or accepted send |
| EXPIRED | No further delivery attempts are permitted |
| DELIVERY_UNKNOWN | An attempt may have been accepted |

SENT means provider acceptance, not inbox delivery.

deliveryOutcome is NOT_SENT, ACCEPTED or MAY_HAVE_BEEN_SENT.
EXPIRED must preserve MAY_HAVE_BEEN_SENT when prior delivery was uncertain.

Terminal statuses are SENT, FAILED, CANCELLED and EXPIRED.
DELIVERY_UNKNOWN requires reconciliation; it must not trigger blind resend.

## Retry and expiry rules

At most five delivery attempts per notification, with backoff and jitter.
Do not start an attempt at or after expiresAt minus two minutes.

The cutoff stops Notification attempts. Auth may still accept a token
until expiresAt.

Reconcile uncertain delivery using non-sensitive provider references.
If uncertainty remains at expiry, record EXPIRED with
MAY_HAVE_BEEN_SENT and delete the sensitive payload.

## Cancellation

Cancellation is best effort.
QUEUED and RETRY_WAIT jobs can be cancelled before sending.
For SENDING or DELIVERY_UNKNOWN, record cancellationRequested without
claiming that sending was prevented.
Terminal results remain unchanged.

Auth token invalidation is authoritative. An older email may still arrive.

## Sensitive storage and retention

Encrypt temporary recipient and verification-link payloads.
Encryption keys and fingerprint keys must be separately managed.
Configuration and rotation require Member 4 confirmation.

Delete sensitive payloads on terminal handling or expiry.
Retain non-sensitive deduplication/status metadata until seven days
after expiresAt.

Auth must preserve request IDs during retries and must not resubmit
after the deduplication retention period ends.

Logs and analytics must exclude tokens, links, recipient addresses,
credentials and delivery payloads.

## Safe errors

Errors use code, message and requestId, without sensitive details.

| HTTP | Meaning |
|---|---|
| 400 | Malformed request |
| 401 | Missing or invalid service credential |
| 403 | Authenticated caller lacks operation permission |
| 404 | Missing or undisclosable record |
| 409 | Idempotency binding conflict |
| 422 | Invalid fields or submission window closed |
| 429 | Request limit exceeded |
| 503 | Temporary storage or required dependency failure |

All internal responses use Cache-Control: no-store.

## Local sink boundary

The local sink performs no external email delivery.
It must not log or persist plaintext verification links.
Local acceptance must be labelled as synthetic delivery.

The OpenAPI specification and implementation must preserve these rules.