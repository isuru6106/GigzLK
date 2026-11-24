# Member 3 — Progress and TODO Tracker

Updated: 2026-11-24 (Asia/Colombo)
Repository: https://github.com/isuru6106/GigzLK

## Current assessment

**28/100 weighted implementation points evidenced; 26/100 merged.**

This is a planning estimate against the full project handbook, not an
official grade or a production-readiness score. The handbook does not
prescribe weights. This rubric provides a consistent tracking baseline.

Evidence comes from shared code, test results and merge confirmations.
The repository has not been independently audited. Unverified work
receives no credit until checked; this does not prove it is absent.

Source: GigZLK Full Project & Team Engineering Handbook v1.0:
- Payments and financial controls: pages 7–8.
- Scheduling, attendance and emergency replacement: pages 8–9.
- Chat and moderation: pages 9–10.
- Reviews and reputation: pages 10–11.
- Member responsibilities: pages 18 and 23–24.
- Roadmap: page 19.
- Definition of Done: page 20.

Member 1 leads frontend implementation. Member 4 leads shared platform
infrastructure. Member 3 still owns domain integration, security, tests,
service packaging and operational readiness.

## Weighted baseline

| Area | Available | Implemented/tested | Merged |
|---|---:|---:|---:|
| Payment lifecycle and financial operations | 30 | 12 | 12 |
| Commission calculation | 5 | 5 | 5 |
| Ledger and financial audit | 10 | 6 | 6 |
| Notifications | 10 | 4 | 2 |
| Chat and files | 10 | 0 | 0 |
| Scheduling and work completion | 8 | 0 | 0 |
| Attendance | 7 | 0 | 0 |
| Emergency replacement | 5 | 0 | 0 |
| Reviews and reputation | 5 | 0 | 0 |
| Disputes | 5 | 0 | 0 |
| Shared delivery and integration readiness | 5 | 1 | 1 |
| **Total** | **100** | **28** | **26** |

Checked items identify evidenced implementation milestones.
They do not imply the full integrated feature meets the handbook's
Definition of Done.

Partial tasks remain unchecked. Points are awarded once per task.

## Payment lifecycle and financial operations — 12/30

- [x] (3) PostgreSQL persistence and internal funding, approval and hold transitions, including concurrency tests.
- [x] (3) Atomic release eligibility, caller-scoped release idempotency and rollback tests.
- [x] (2) Approval HTTP/repository foundation with durable retries and fail-closed access clients; live authorization remains pending.
- [x] (2) Internal payout success/failure simulator and terminal retry protection; no real money transfer.
- [x] (2) Transactional payment outbox, Kafka publisher and local runner.
- [ ] (4) Integrate authoritative session validation, assignment permissions and work-completion checks; reauthorize retries.
- [ ] (3) Trusted contract-bound payment creation and verified funding callbacks, including signature and duplicate-event checks.
- [ ] (3) Provider sandbox funding and payout execution, including uncertain-result reconciliation; alternatively obtain explicit team agreement on simulator-only scope.
- [ ] (3) Refunds and financial cancellation workflow with authorization and accounting consequences.
- [ ] (2) Worker withdrawal requests and authorized payout history.
- [ ] (1) Receipts and invoices.
- [ ] (1) Milestone payments, or explicitly reviewed scope deferral.
- [ ] (1) Authorized financial history and reports for users and administrators.

## Commission — 5/5

- [x] (3) Backend 10% commission calculation using integer minor units and tested rounding.
- [x] (2) Persist gross, commission and net amounts in release journals; test boundaries including zero-rounded commission.

Frontend consumption and integrated delivery are assessed separately.

## Ledger and financial audit — 6/10

- [x] (3) Balanced release journal stored atomically with payment release.
- [x] (3) Database mutation protection and complete-entry validation with integration tests.
- [ ] (2) Accounting for refunds, reversals and actual settlement.
- [ ] (1) End-to-end job, publisher, worker and transaction audit linkage through reviewed contracts.
- [ ] (1) Authorized admin financial decisions, audit queries and reconciliation/reporting.

## Notifications — 4/10

- [x] (2, merged) Service scaffold, liveness, PostgreSQL migration, request validation, encrypted payloads, keyed fingerprints and durable acceptance tests.
- [x] (2, tested branch) Local simulator, exclusive claims, delivery worker, bounded retries, uncertain delivery, crash recovery, cancellation and payload deletion tests.
- [ ] (1) Finish and test retention cleanup; connect maintenance execution; complete regression checks and worker PR review/merge.
- [ ] (1) Authenticated internal acceptance, status, by-request lookup and cancellation routes with operation scopes, safe errors and no-store.
- [ ] (1) Configuration, separate encryption/fingerprint keys, rotation, local runner and setup documentation.
- [ ] (1) Reviewed Auth integration, verification-page URL agreement and real email delivery or explicitly approved simulator scope.
- [ ] (1) Kafka consumers for marketplace, payment and operations notifications with deduplication and failure handling.
- [ ] (1) Authorized in-app notifications and read state; push where supported and agreed.

Current branch: `feat/member3-notification-delivery-worker`.

Latest confirmed results:
- 7 acceptance PostgreSQL integration tests pass.
- 14 delivery PostgreSQL integration tests pass.
- 10 worker unit tests pass.
- ESLint passes for the latest tested changes.

Retention cleanup and maintenance execution are tested. The local runner
starts and stops successfully. Regression results: 79 unit tests,
1 HTTP test and 25 PostgreSQL integration tests pass.

Worker PR review/merge, production configuration, key-ring loading and
live integrations remain pending.

## Chat and files — 0/10

- [ ] (3) Assignment/job-scoped persistent text chat with membership authorization and pagination.
- [ ] (2) Secure image and work-file uploads/downloads, size limits, content validation and signed access.
- [ ] (2) Authenticated real-time delivery, reconnect behavior, read receipts and typing indicators.
- [ ] (2) Off-platform contact/payment warnings, reviewed moderation integration, escalation and audit.
- [ ] (1) Message notification events and access/failure/integration tests.

## Scheduling and work completion — 0/8

- [ ] (2) Create/update schedules from authoritative accepted contracts with revision and conflict handling.
- [ ] (1) Calendar-friendly API and job location/map data for Member 1.
- [ ] (2) Configurable reminders, timezone handling and duplicate suppression.
- [ ] (1) Time-to-leave support where justified, or reviewed deferral.
- [ ] (2) Work submission, revisions/completion evidence and trusted approval handoff; agree ownership boundaries with Member 2.

## Attendance — 0/7

- [ ] (2) Authorized assignment-bound check-in/out and attendance history.
- [ ] (2) QR/GPS evidence where appropriate, replay protection and location consent/minimization.
- [ ] (1) Arrival, late and grace-period rules with timezone tests.
- [ ] (1) Attendance events and scheduling/emergency integration.
- [ ] (1) Authorization, duplicate, fraud/edge-case and end-to-end tests.

## Emergency replacement — 0/5

- [ ] (1) Evidence-based late/no-show detection, grace period and response prompt.
- [ ] (1) Publisher alert and authorized replacement request.
- [ ] (1) Opt-in availability, travel distance, minimum payment and incentive contracts with Members 2/4.
- [ ] (1) Matching and urgent offers with explicit worker acceptance and race-safe final confirmation.
- [ ] (1) Reviewed consequences, genuine-emergency handling, audit and tests.

## Reviews and reputation — 0/5

- [ ] (2) Eligible post-work ratings/reviews with authorization, duplicate rules and moderation.
- [ ] (1) Transparent completion/reliability metrics and reputation events, separate from match scores.
- [ ] (1) Badge rules that treat new workers fairly.
- [ ] (1) Member 4 sentiment/risk integration, Member 1 display contract and tests.

## Disputes — 0/5

- [ ] (1) Authorized dispute creation and status workflow.
- [ ] (1) Secure evidence and access-controlled job/chat/payment history.
- [ ] (1) Reviewed admin resolution and decision audit trail.
- [ ] (1) Financial hold/refund/release integration with explicit authority; no AI-only irreversible decisions.
- [ ] (1) Access, workflow, financial race and integration tests.

## Shared delivery and integration readiness — 1/5

- [x] (1) Payment CI, recorded reviewed merges, payment/demo documentation and local demonstrations.
- [ ] (1) Notification CI, domain test pipelines and documented API/event schemas, including a machine-readable Notification contract.
- [ ] (1) Service Dockerfiles, safe environment examples, Compose integration and verified runtime entry points/probes with Member 4.
- [ ] (1) Metrics, safe logs, deployment/secrets integration, security/rate/file controls and failure/load tests.
- [ ] (1) Member 1 frontend integration, Member 2/4 cross-service tests and a complete documented end-to-end demonstration.

## Next work, in order

1. Finish and test Notification retention cleanup.
2. Connect maintenance execution.
3. Check cancellation immediately before dispatch where practical,
   document the remaining in-flight race and test it.
4. Complete local worker configuration, runner and synthetic demonstration.
5. Update Notification contracts and CI; run regression checks.
6. Open, review and merge the worker PR.
7. Agree service credentials, verification URL and Auth handoff.
8. Implement authenticated Notification routes and integration.
9. Build a thin contract → schedule → attendance → completion →
   approval → release flow.
10. Add chat, reviews and disputes in reviewed vertical slices.
11. Complete remaining financial features or record team-approved deferrals.

A deferred feature does not automatically earn completion points.

## GitHub tracking workflow

The handbook requires:
Issue → branch → implementation → tests → PR → CI → review → merge.

- [ ] Create or link an umbrella Member 3 tracking Issue.
- [ ] Create or link Issues for the next implementation milestones.
- [ ] Add real Issue/PR links to this document.
- [ ] Update this document in each relevant feature PR.

Suggested umbrella Issue title:
`Member 3 roadmap and handbook progress tracking`

Use existing repository labels. Do not invent Issue or PR numbers.

This tracker may be committed on the current worker branch without
merging unfinished worker code. Stage only this document when making
a standalone documentation commit.

## Progress update rules

- Update checkboxes, evidence, points, date and change log together.
- Distinguish tested branch work from reviewed and merged work.
- After the worker merge, move its 2 points into the merged column;
  do not award those implementation points again.
- Award points only after the stated milestone is evidenced.
- Keep partial tasks unchecked with a short progress note.
- Treat unknown work as unverified until checked.
- Record scope/weight changes explicitly and preserve baseline history.
- Update during active work sessions and feature PRs.
- No background synchronization is configured.

## Definition of Done

Apply the handbook's full checklist before calling an integrated feature Done:

- [ ] GitHub Issue exists.
- [ ] Implementation is on a feature branch.
- [ ] API, database and event contracts are documented.
- [ ] Validation and authorization are implemented.
- [ ] Relevant frontend loading, empty and error states exist.
- [ ] Important unit, integration and API tests pass.
- [ ] Docker configuration works.
- [ ] No secrets are committed.
- [ ] Logging and observability are adequate.
- [ ] PR is reviewed.
- [ ] CI passes.
- [ ] Cross-domain integration is tested.
- [ ] Documentation is updated.
- [ ] Changes are merged after review.

## Evidence and change log

| Date | Milestone | State |
|---|---|---|
| 2026-11-23 | Payment outbox, CI, ledger protection, approval commands, payout simulator and demo | User-confirmed merges; add historical PR links |
| 2026-11-23 | Notification storage foundation | Merged; subsequent main shown at `3b4be87` |
| 2026-11-24 | 7 acceptance PG tests, 14 delivery PG tests and 10 worker unit tests passing | Acceptance merged; delivery/worker on feature branch |
| 2026-11-24 | Handbook-based weighted baseline established | 28 implementation points; 26 merged points |

Earlier informal overall completion estimates are superseded by this
explicit rubric. The handbook alone cannot establish an exact objective
percentage.