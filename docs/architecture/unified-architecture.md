# GigZLK Unified Architecture

Status: Working architecture proposal
Updated: 2026-10-05
Coordinator: Member 4

## 1. Decision status

- ESTABLISHED: Existing project requirement or assigned responsibility.
- ALIGNED: Members have independently accepted the direction.
- PROPOSED: Specific implementation choice awaiting confirmation.
- OPEN: Unresolved decision with an identified owner.

Alignment does not imply approval of every API or event schema.

## 2. Team ownership

| Member | Ownership |
|---|---|
| 1 | Marketplace/admin frontends, UI and frontend integration |
| 2 | Auth, User, Job, Application and Contract |
| 3 | Payment, Operations, Chat and Notification |
| 4 | ML service, shared infrastructure, CI/CD and observability |

Business logic remains with its domain owner.
Member 4 does not own financial calculations or domain authorization.

## 3. Aligned technology direction

- Separate Next.js/TypeScript marketplace and admin applications.
- NestJS/TypeScript domain services.
- PostgreSQL with service-owned databases and migrations.
- Independent Python/FastAPI ML service.
- Kafka for asynchronous domain integration.
- Redis for explicitly defined temporary state and caching.
- Docker Compose before Kubernetes.
- GitHub Actions for CI/CD.
- Prometheus, Grafana and centralized structured logs.

Registry, gateway implementation, object storage, vector storage
and cloud deployment destination remain open.

## 4. Repository layout

Preserve the existing foundation:

- apps/marketplace
- apps/admin
- services/
- ml-service/
- infrastructure/
- k8s/
- docs/architecture/
- docs/api/
- docs/events/
- docs/ml/
- docs/deployment/
- .github/workflows/

Create files when implementation requires them.
Do not add placeholder files merely to track empty directories.

## 5. Data boundaries

Each service owns its database, credentials and migrations.
One PostgreSQL instance with separate databases is acceptable locally.

No service reads or writes another service's private tables.
Use authorized APIs and versioned events.

ML stores derived features, indexes and analysis results.
Domain services remain authoritative.

Redis is not authoritative for financial balances, assignments,
idempotency records, accepted terms or durable scheduled tasks.

## 6. Proposed API conventions

Public REST prefix: /api/v1
Private service API prefix: /internal/v1

Internal APIs and metrics must not be publicly routed.

Proposed list response:
{ items, nextCursor, hasMore }

Default page limit: 20
Maximum page limit: 100
Use deterministic cursor ordering.

Proposed error response:
{ code, message, requestId, details?, retryAfterSeconds? }

Use appropriate HTTP status codes and safe messages.
Use 409 for version conflicts and idempotency payload mismatches.
Use 202 with an operation reference for asynchronous commands.

Timestamps use UTC ISO 8601.
Schedules also identify an IANA timezone.
Mutable resources expose versions where concurrency matters.

Money uses integer minor units plus currency.
Payment owns commission, rounding, settlement and net amounts.
Serialization bounds must be defined before financial integration.

## 7. Proposed browser and gateway architecture

Each application uses same-origin API and WebSocket routes.

- /api/v1/*
- /ws/chat
- /ws/notifications

Member 4 owns proxy deployment, routing, TLS and observability.
Member 2 owns identity policies and authentication integration.
Each service enforces role and resource-level authorization.
Member 3 owns domain WebSocket handlers.

Proposed authentication:
- Asymmetrically signed access JWTs and public JWKS.
- Secure, HttpOnly, host-only cookies.
- Separate marketplace and admin sessions.
- No shared parent-domain authentication cookie.
- Rotating opaque refresh tokens stored hashed in PostgreSQL.
- CSRF protection and allowed-Origin validation.
- Mandatory backend-enforced admin MFA.
- Authenticated sockets with expiry/revocation handling.
- No tokens in URLs.

Member 2 proposes a 10-minute access lifetime.
Admin refresh/session limits remain to be specified.

A basic reverse proxy does not automatically validate JWTs.
Gateway authentication requires an explicit supported integration.

## 8. Proposed assignment lifecycle

Contract Service owns canonical assignment IDs.

Each worker engagement has its own assignment and contract.
A replacement creates a new assignment linked to the original.

Proposed lifecycle:
1. Contract Service commits CONTRACT_ACCEPTED.
2. Payment verifies funding and commits ASSIGNMENT_FUNDED.
3. Operations verifies prerequisites and commits ASSIGNMENT_READY.
4. Operations records attendance and work submission.
5. Operations commits ASSIGNMENT_COMPLETED after authorized approval.
6. Payment validates eligibility and commits PAYMENT_RELEASED.
7. Payment confirms external transfer with PAYOUT_SUCCEEDED.
8. Operations records an eligible review.

Remove ambiguous JOB_CONFIRMED from the proposed contract.

Payment-funded and assignment-funded semantics need confirmation.
Assignment completion is distinct from whole-job completion.
Job Service owns whole-job completion policy.

Funding, holds, release, refund and payout require authoritative
state checks. ML results never authorize financial transitions.

## 9. Contracts, cancellation and replacement

Accepted contract versions are immutable.
Amendments require explicit acceptance and cross-domain validation.

Cancellation starts as a request.
Final cancellation depends on agreed operational and settlement rules.

Operations coordinates replacement.
Application owns binding offers.
Contract owns new agreements and assignment IDs.
Payment owns settlement and any explicit fund reallocation.

Capacity reservation and acceptance concurrency remain open.
Cross-service database boundaries prevent assuming one shared transaction.

Original attendance, contract and payment history must be preserved.

## 10. Proposed event conventions

Versioned JSON envelope:
- eventId
- eventType
- schemaVersion
- producer
- aggregateId
- aggregateVersion
- occurredAt
- correlationId
- causationId, when applicable
- data

Proposed topic direction: one topic per producing service.
Final topic names and access rules remain to be documented.

Use transactional outboxes and durable consumer deduplication.
Partition by the relevant aggregate identity.
Do not assume ordering across topics.

Proposed retry default: five retries with backoff and jitter.
Non-retryable failures go directly to failure handling.
Dead-letter handling is consumer-specific.
Controlled replay preserves event IDs.

Ordering-sensitive consumers must not silently skip failed versions.
Define recovery and version-gap behavior per workflow.

Events exclude credentials and unnecessary personal information.
Private review content requires restricted access.
Do not forward internal Kafka payloads directly to browsers.

## 11. ML service

Initial planned APIs:
- POST /api/v1/ml/match
- POST /api/v1/ml/recommend
- POST /api/v1/ml/pricing
- POST /api/v1/ml/fraud
- POST /api/v1/ml/sentiment

Implement explainable matching first.
Recommendations begin with eligibility filtering and baseline ranking.

Return score semantics, factors, missing inputs, result version
and freshness information.

A rule-based score is not a hiring probability.
Unavailability must not be represented as a zero score.

Use authorized internal APIs for initial data loading.
Consume versioned updates and deletion tombstones.
Proposed reconciliation frequency: nightly.

Only eligible published jobs enter discovery recommendations.
Domain services recheck eligibility when applying or accepting.

Pricing and forecasting require suitable data.
Synthetic fixtures are test data, not evidence of model accuracy.

AI-assisted job creation is deferred.
Vector storage and embedding choices remain open.

## 12. Local runtime proposal

These are host mappings, not necessarily container ports.

| Component | Host port |
|---|---:|
| Marketplace | 3000 |
| Admin | 3001 |
| User | 3002 |
| Job | 3003 |
| Application | 3004 |
| Contract | 3005 |
| Auth | 3006 |
| Payment | 3010 |
| Operations | 3011 |
| Chat | 3012 |
| Notification | 3013 |
| ML | 8000 |

Auth moves from 3001 to avoid the admin port conflict.
Bind development-only infrastructure ports to loopback.
Final gateway and infrastructure mappings remain open.

Services expose:
- /health/live
- /health/ready
- private /metrics, where implemented

Liveness checks process health.
Readiness reflects the service's ability to accept work.
Optional dependency failures must not cause restart loops.

## 13. Delivery and observability

Each member owns service tests, migrations and application containers.
Member 4 coordinates shared checks and deployment configuration.

PR checks:
lint, type checks, tests, builds and relevant security scans.

Trusted-branch delivery:
build image, scan image, publish immutable commit tag,
deploy staging, run smoke checks and support rollback.

Run migrations once through a controlled deployment task.
Do not run them concurrently from every replica.

Add structured logs, request/correlation IDs and metrics early.
Monitor API errors/latency, consumer lag, outbox backlog,
payment failures, notification retries and ML errors.

Never commit real secrets.
Logs must exclude tokens, credentials and sensitive payloads.

Kubernetes follows a working local integration.
Use restricted service accounts, resource limits, probes,
network policies and injected secrets.

## 14. Open decision register

| Decision | Owner/confirmer |
|---|---|
| API pagination/error conventions and host ports | Members 1, 2, 3, 4 |
| Gateway tool and authentication integration | Members 2, 4 |
| Browser/socket session behavior and admin limits | Members 1, 2, 3 |
| Funding/readiness event semantics and deadlines | Members 2, 3 |
| Amendment/cancellation settlement workflow | Members 2, 3 |
| Capacity reservation during offer acceptance | Member 2, coordinated with Member 3 |
| Final topics, schemas, ACLs and replay procedures | Producers/consumers, coordinated by Member 4 |
| LKR fixed-total MVP and commission/refund policy | Members 1, 2, 3 |
| Automatic payout versus withdrawal | Members 1, 3 |
| ML scoring fields, freshness and persistence | Member 4 with consumers |
| Storage/scanning and retention/deletion policy | Members 2, 3, 4 |
| Registry and cloud deployment destination | Member 4 with team |

## 15. Member 4 implementation sequence

1. Architecture, API conventions and event documentation.
2. Docker Compose for PostgreSQL, Kafka and Redis.
3. FastAPI skeleton, configuration and health endpoints.
4. Explainable matching baseline with labelled test fixtures.
5. CI, security checks, logs and basic metrics alongside implementation.
6. Contract-based integration with domain services.
7. One complete simulated assignment lifecycle and dispute-block test.
8. Kubernetes staging, dashboards, alerts and deployment hardening.
