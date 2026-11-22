# Payment API v1

Status: PROPOSED — HTTP implementation and live integration pending
Owner: Member 3
Reviewers: Members 1, 2 and 4

## Implemented foundation

- PostgreSQL payment persistence.
- Atomic funding, approval and hold transitions.
- Atomic release with ledger entries and caller-scoped idempotency.
- Backend-calculated 10% commission.
- Database integration tests covering concurrency and rollback.

These internal services do not establish user authorization.
External funding, refunds and payouts are not implemented.

## Proposed public operations

| Method | Path | Purpose |
|---|---|---|
| GET | /api/v1/payments/{paymentId} | Read an authorized payment |
| POST | /api/v1/payments/{paymentId}/approve | Publisher approves completed work |

No public operation allows a client to mark funding successful,
change a hold or directly invoke the internal release service.

Approval records work approval. It does not claim external payout.

## Authorization

- Require validated user proof and authoritative current session/account state.
- Obtain account identity from validated proof, never request-body identity.
- Confirm assignment membership and current permissions through Member 2.
- Workers may read their own assignment payment view.
- Publishers may read their own assignment payments.
- Only the assignment's authorized publisher may approve completed work.
- Confirm completion through the authoritative Operations workflow.
- Admin access requires a separate reviewed admin authentication contract.
- Missing authorization dependencies deny access with a safe operational error.
- Never fall back to decoded claims or caller-supplied identity headers.
- Reauthorize retries before returning financial information.

Auth checking does not lock state across services. The allowed interval
between validation and mutation, and assignment-change race handling,
require agreement with Members 2 and 4.

## Trusted internal workflow

Payment creation obtains the assignment, accepted contract version,
publisher, worker, amount and currency from trusted contract data.

Funding requires a verified simulator/provider result bound to the payment,
expected amount, currency and unique provider event.

Approval requires verified publisher ownership and assignment completion.

Release requires funding, approval and no active financial hold.
Release and the balanced journal are stored in one database transaction.

Release records worker payable. External payout is a separate operation.

Internal HTTP routes and service credentials remain OPEN.
Repository methods must not be exposed directly as controllers.

## Amount representation

JSON monetary values use decimal strings containing integer minor units,
plus an explicit currency. No decimal rupee values are accepted as truth.

For LKR:
- grossMinor: "1000000" means Rs. 10,000.
- commissionMinor: "100000" means Rs. 1,000.
- netMinor: "900000" means Rs. 9,000.

Amounts and commission come from backend records and calculations.
Before release, commission/net figures are estimates labelled accordingly.
After release, return the recorded journal amounts.

## Proposed response fields

- paymentId
- assignmentId
- grossMinor
- currency
- fundedAt
- approvedAt
- holdActive
- releasedAt
- version
- createdAt
- updatedAt

Timestamps are UTC ISO 8601 strings or null.
Internal caller IDs and idempotency keys are not returned publicly.
Additional fields are explicitly allowlisted per authorized viewer.

## Approval requests and retries

- Require an Idempotency-Key header.
- No client amount, commission, worker ID or publisher ID is accepted.
- Persist caller, operation, key and request binding durably.
- Identical authorized retries return the recorded result.
- Changed binding under the same scoped key returns 409.
- Timeouts do not prove that approval failed.
- Approval HTTP idempotency is not implemented by the current repository alone.

## Proposed errors

Envelope: code, message, requestId.

| HTTP | Code | Meaning |
|---|---|---|
| 400 | INVALID_REQUEST | Invalid UUID, header or unexpected input |
| 401 | SESSION_INVALID | Invalid user proof or inactive session |
| 403 | ACCESS_DENIED | Known permitted resource, disallowed operation |
| 404 | PAYMENT_NOT_FOUND | Missing or undisclosable payment |
| 409 | PAYMENT_STATE_CONFLICT | Operation conflicts with payment state |
| 409 | IDEMPOTENCY_CONFLICT | Scoped key reused with different binding |
| 429 | RATE_LIMITED | Request limit exceeded |
| 503 | AUTH_UNAVAILABLE | Required Auth validation unavailable |
| 503 | ASSIGNMENT_UNAVAILABLE | Required assignment validation unavailable |
| 503 | PAYMENT_UNAVAILABLE | Payment storage or required dependency unavailable |

Service credential failures remain distinct from invalid user sessions.
Never expose credentials, database errors or provider internals.
All payment responses, including errors, use Cache-Control: no-store.

## Events

Release events require a transactional outbox before Kafka integration.
A database release must not depend on a successful direct Kafka publish.
Outbox, event schemas and consumers remain to be implemented.

## Open integration decisions

- Member 1: payment display, approval UI and uncertain-response recovery.
- Member 2: assignment/contract lookup and Payment's permitted Auth caller.
- Members 2/3: completion proof and assignment revision checks.
- Member 4: internal credentials, routing, rate limits and deployment.
- Member 3: durable approval idempotency, outbox and ledger edit protection.

No live financial endpoint is enabled by this draft.