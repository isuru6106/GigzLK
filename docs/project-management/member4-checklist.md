# Member 4 delivery checklist

Owner: Member 4 - AI/ML and Platform Engineering

Evidence update: 28 November 2026.
Latest confirmed local main: 5ab4db7, including merged PR #88.

This checklist tracks the team-handbook scope and agreed follow-up work.
Checked items describe evidence-backed work within the stated scope.
Local verification, merged implementation and live integration are distinct.

## 1. Verified foundations

- [x] Explainable rule-based job-worker matching API.
- [x] Request validation and missing-data handling.
- [x] Original matching baseline: 67 tests passed.
- [x] Base ML dependency locks, Docker build and health checks.
- [x] Local PostgreSQL, Redis and Kafka foundation.
- [x] Private Auth Compose runtime and controlled migration task.
- [x] ML, Auth and gateway CI foundations.
- [x] Isolated gateway routing, TLS, headers and body forwarding.
- [x] Gateway failure, retry and body-limit checks: 19 tests passed.
- [x] Platform/authentication reviews completed to the recorded stages.

Latest reported local ML suite: 256 tests passed.
This includes 32 survey-importer tests and 26 payment-baseline tests.
Local test results do not establish passing hosted CI or live integration.
PR #88 is merged; the supplied PR screenshot showed 0 checks. Applicable
hosted CI and review evidence for that PR still need confirmation.

## 2. Planning and integration contracts

- [x] Merge the delivery checklist through PR #52.
- [x] Create planning Issue #51 with acceptance criteria.
- [x] Document existing matching inputs and limitations.
- [x] Record Members 1-3's recommendation reviews and unresolved decisions.
- [x] Record Member 1's proposed response fields and UI requirements.
- [x] Record the emergency-matching ownership boundary with Member 3.
- [x] Record worker_id as the assessed worker entity, with its mapping
      to an Auth account or separate profile remaining OPEN.
- [ ] Create remaining implementation Issues with acceptance criteria
      and dependencies.
- [ ] Agree final assessed AI scope, priorities and milestones.
- [ ] Confirm Job/User fields, identifiers and authorized API/event contracts.
- [ ] Finalize recommendation/search response schemas, pagination,
      retrieval limits, freshness and failure behavior.
- [ ] Finalize emergency matching inputs, preferences, offers and
      assignment integration contracts.
- [ ] Define supported languages and initial job categories.
- [ ] Define payment prediction target, units and supported categories.
- [ ] Define live data access, permitted uses, retention and deletion.
- [ ] Resolve identifier-comparison rules before live scoring integration.

Additional recorded contract work:
- [x] Merge the proposed recommendation API document through PR #82.
- [x] Record Member 1 and Member 2 confirmations of synthetic mock scope
      and unresolved live decisions through PR #83.
- [x] Record Auth identity/session ownership separately from domain
      disclosure, eligibility, capacity, conflict and action permissions.
- [x] Record support for bounded, non-paginated synthetic mocks and
      default-off known schedule/location mismatch filters.
- [ ] Finalize canonical revision-string range/validation and error
      requestId format/propagation; these remain supported proposals.

Planning Issue #51 remains open.
Recorded support for a direction does not approve unresolved live contracts.

The current rules-v1 scorer normalizes skill/location identifiers.
Opaque canonical identifiers must follow their owning source contract;
the existing normalization must not be assumed valid for live integration.

## 3. Vector search and recommendations

### 3.1 Vector storage and embeddings

- [x] Configure isolated PostgreSQL/pgvector development storage.
- [x] Enable pgvector and verify vector similarity queries.
- [x] Configure restricted application/client database roles.
- [x] Add optional loopback-only host database access.
- [x] Create synthetic source, embedding-model and embedding schemas.
- [x] Prepare seven explicitly synthetic source fixtures.
- [x] Select intfloat/multilingual-e5-small for the prototype.
- [x] Pin the model revision and record preprocessing configuration.
- [x] Verify 384-dimensional, finite, normalized embeddings.
- [x] Generate embeddings for visible synthetic jobs and workers.
- [x] Store entity IDs, source revisions and embedding-model versions.
- [ ] Complete embedding-model licence/resource documentation.
- [ ] Evaluate required language support, including Sinhala/English
      where agreed.
- [ ] Fully lock the embedding-development dependencies.
- [ ] Verify embedding-model execution and resource use on Linux.

The database-check dependency lock is separate from the full
embedding-development environment.

### 3.2 Retrieval and source consistency

- [x] Implement command-line semantic job and worker retrieval.
- [x] Filter retrieval by entity kind, source revision, visibility and model.
- [x] Verify repeat indexing and synthetic demonstration queries.
- [x] Exclude hidden, unknown and deleted sources despite retained vectors.
- [x] Recognize duplicate and stale source updates.
- [x] Reject conflicting equal revisions.
- [x] Remove associated embeddings when applying newer source revisions.
- [x] Remove searchable text and embeddings on synthetic withdrawals.
- [x] Preserve synthetic deletion tombstones against resurrection.
- [x] Verify concurrent source delivery using independent connections.
- [x] Extract shared transactional embedding publication.
- [x] Revalidate source snapshots before publishing embeddings.
- [x] Verify publication versus withdrawal in both commit orders.
- [x] Reject publication against newer source revisions.
- [x] Verify complete publication-batch rollback.
- [ ] Implement validated rebuilding and index switching.
- [ ] Implement source reconciliation.
- [ ] Define tombstone retention and recovery procedures.
- [ ] Integrate authorized live ingestion.

Direct table writes can bypass the update/publication helpers.
Synthetic ordering and tombstone rules do not establish a live source contract.

### 3.3 Retrieved-worker assessments - merged in PR #70

- [x] Attach existing rules-v1 assessments to retrieved synthetic workers.
- [x] Preserve semantic ordering with deterministic worker-ID tie-breaking.
- [x] Keep semantic similarity separate from suitability scores.
- [x] Preserve factor explanations, missing fields and mismatch warnings.
- [x] Reject duplicate candidates and invalid synthetic inputs.
- [x] Bound assessment requests to 100 candidates.
- [x] Pass 34 worker-assessment tests.
- [x] Pass four PostgreSQL worker-assessment integration checks.
- [x] Include worker-assessment database verification in vector CI.
- [x] Merge PR #70 with two checks reported passed.

### 3.4 Retrieved-job assessments - merged in PR #71

- [x] Implement rules-v1 assessments of retrieved jobs for one worker.
- [x] Supply relevant experience separately for each candidate job.
- [x] Reject a shared worker-level experience value.
- [x] Keep known zero experience distinct from unknown experience.
- [x] Preserve semantic ordering, metadata and mismatch warnings.
- [x] Preserve input snapshots without mutation.
- [x] Reject duplicate candidates and invalid synthetic inputs.
- [x] Bound assessment requests to 100 candidates.
- [x] Pass 42 job-assessment tests.
- [x] Pass four PostgreSQL job-assessment integration checks.
- [x] Verify rollback of temporary sources, vectors and model registrations.
- [x] Stage the job-assessment workflow and documentation changes.
- [x] Commit and push the job-assessment branch.
- [x] Open PR #71.
- [x] Record two checks reported passed for PR #71.
- [x] Merge the job-assessment implementation through PR #71.


### 3.5 Automated database verification

- [x] Merge isolated vector database CI through PR #68.
- [x] Use a fresh PostgreSQL/pgvector database in CI.
- [x] Generate temporary database passwords.
- [x] Support non-interactive CI password input and local hidden prompts.
- [x] Use restricted database credentials for Python checks.
- [x] Make retrieval and source-update checks independent of demo embeddings.
- [x] Run database checks without PyTorch or model downloads.
- [x] Verify temporary-record cleanup.
- [x] Add retrieved-worker assessment to automated database verification.
- [x] Include retrieved-job assessment in CI; PR #71 reports two passing checks.

### 3.6 Relevance evaluation and suitability filters

- [x] Implement tested Precision@K, Recall@K and NDCG@K calculations
      through PR #74; 22 metric tests passed locally.
- [x] Compare synthetic embedding retrieval with a keyword Jaccard baseline
      and record input hashes, model metadata and per-query results.
- [x] Preserve the v1 dataset with 12 candidates and eight queries.
- [x] Expand development evaluation to 20 candidates and ten queries,
      including related alternatives and two no-match cases, through PR #75.
- [x] Record that both retrieval methods still return unrelated candidates
      for no-match cases; semantic abstention remains unimplemented.
- [x] Implement optional known schedule/location mismatch filters for
      assessed synthetic jobs and workers through PR #76.
- [x] Keep filters disabled by default, retain unknown information,
      preserve semantic order and metadata, and renumber remaining ranks.
- [x] Pass 33 synthetic filter tests locally.
- [x] Verify retrieval, assessment and filtering against PostgreSQL for
      workers and jobs through PR #81, including empty filtered pools
      and rollback of temporary records.
- [ ] Obtain independent review of synthetic relevance judgments.
- [ ] Evaluate agreed language coverage and held-out relevance examples.
- [ ] Agree and validate live ranking/filtering policy, including any
      combined ranking score and no-match behavior.

The recorded relevance judgments are DRAFT_UNREVIEWED. These small English
development sets do not establish production accuracy or Sinhala quality.
Current ordering follows semantic similarity. Suitability explanations
remain separate; filters do not establish authoritative eligibility.

### 3.7 Recommendation proposal and frontend mock fixtures

- [x] Document proposed worker/job recommendation operations, validation,
      explanations, optional filters, empty outcomes and failure boundaries.
- [x] Record cross-member acceptance of synthetic mock behavior only.
- [x] Generate synthetic worker/job frontend fixtures through PR #84,
      including complete, mismatched, incomplete, empty, unavailable and
      unauthorized examples.
- [x] Generate mock suitability through the existing rules-v1 scorer.
- [x] Label mock freshness and invented semantic-ordering inputs explicitly.
- [ ] Confirm implementation of Member 1's frontend screens and interactions.
- [ ] Finalize authorized display composition, source freshness,
      error contracts, canonical identifiers and revision serialization.
- [ ] Finalize pagination, retrieval budgets and result-set lifecycle.

Mock fixtures do not implement HTTP response adapters, actual no-store
headers, live visibility checks or authorization. Proposed revision strings
and requestId examples are not finalized live contracts.

### 3.8 Remaining live recommendation delivery

- [ ] Build semantic/natural-language search with agreed structured filters.
- [ ] Implement recommendation HTTP APIs against reviewed contracts.
- [ ] Implement caller authorization and authoritative disclosure checks.
- [ ] Revalidate visibility and freshness before live disclosure.
- [ ] Preserve authoritative backend eligibility checks on submitted actions.
- [ ] Integrate authorized backend source APIs/events.
- [ ] Verify Member 1's frontend integration against real services.
- [ ] Extend retrieval for emergency replacement candidates.

There is no verified completed live recommendation HTTP API or frontend
integration in the evidence recorded here.

Member 4 retrieves and assesses emergency candidates.
Member 3 coordinates the operational workflow with domain owners.
Final assignment requires authoritative checks and worker acceptance.

## 4. Data collection and review

### 4.1 Survey importer - merged in PR #86

- [x] Prepare and publish the bilingual worker survey and collect responses.
- [x] Add actual-payment question Q18a and clarify hours/day questions.
- [x] Change night/weekend/overtime question to multiple selections.
- [x] Implement CSV import mapping by question identifier, independent
      of column order, including Q18a appearing last in exports.
- [x] Require confirmed age, qualifying-work eligibility and consent
      answers before including a response in normalized review output.
- [x] Keep agreed payment and actual received payment separate.
- [x] Preserve unknown numeric values separately from explicit zero.
- [x] Prevent team-only amounts becoming individual payment labels.
- [x] Flag selected inconsistencies and possible duplicate answers.
- [x] Omit timestamps and identifying free text from normalized output.
- [x] Keep normalized records pending review and ineligible for training.
- [x] Pass 32 synthetic importer tests locally and document limitations.
- [x] Keep private survey input/output under ignored ml-service/data/.
- [x] Merge importer, tests and documentation through PR #86.

The raw Google Forms CSV and cleaned payment master have different schemas.
The raw survey importer must not accept the cleaned master by renaming it.
Confirmed answers are self-reports, not independent verification.

### 4.2 Private pilot data preparation

- [x] Prepare a website collection schema and spreadsheet template.
- [x] Review the supplied 50-response survey and 50-row website workbook.
- [x] Retain all 100 records in a private cleaned master with source type,
      source row/file hash, payment units and review flags.
- [x] Keep advertised, agreed, received and benchmark payment columns separate.
- [x] Separate 14 uploaded benchmark ranges from observed advertised labels.
- [x] Normalize unambiguous formatting without inventing dates or amounts.
- [x] Review survey job dates, amount availability and payment-period conflicts.
- [x] Prepare a conservative 13-record actual-pay candidate subset for
      offline exploration, not automatic production approval.
- [x] Check 17 original listing detail pages and prepare 16 advertised-only
      candidates; an earnings ceiling remains unsuitable as fixed base pay.
- [x] Collect two additional public-advertisement records separately.
- [x] Preserve current-source differences and link repairs in review evidence.
- [x] Prepare a private review queue, cleaning log and reproducible outputs.
- [ ] Resolve outstanding source provenance and data-quality questions.
- [ ] Independently verify selected pay/hour/date interpretations.
- [ ] Finalize category mappings and supported training categories.
- [ ] Finalize contact, permitted-use, retention and deletion arrangements.
- [ ] Confirm source-specific collection/reuse conditions before expanded use.
- [ ] Request authorized anonymized completed-job records from employers.
- [ ] Review all repost/employer relationships and suspicious listings.
- [ ] Establish sufficient independent coverage for meaningful evaluation.
- [ ] Build an authorized repeatable website/API collector if still needed.
- [ ] Add browser automation or AI-assisted extraction only where justified.
- [ ] Schedule repeat collection after validation and applicable permission checks.

Private pilot preparation does not establish that a collector is merged into
the repository or that third-party reuse is approved. Advertisement amounts
are not evidence of completed payments. Missing evidence remains unknown.
No personal contacts or application messages are needed for these datasets.
A separately trained AI browsing agent is not currently a deliverable.

## 5. Payment estimation

### 5.1 Offline received-pay baseline - merged in PR #88

- [x] Document the exploratory target: self-reported work payment received
      per actual hour, in LKR, and its distinction from gross job budget.
- [x] Use actual hours only as the historical label denominator, not a
      prediction feature available before work.
- [x] Implement a standard-library global median baseline and a category
      median comparison with global fallback for small category groups.
- [x] Reject advertisement/benchmark source types and nonqualifying markers.
- [x] Require finite positive payment/hours and unique input record IDs.
- [x] Run the local offline baseline on 13 prepared survey candidates.
- [x] Refit leave-one-record-out diagnostics without the held record's label.
- [x] Record model/evaluation metadata, input hash and row-level diagnostics
      privately, and reject existing output directories.
- [x] Pass 26 synthetic baseline tests and the full 256-test ML suite locally.
- [x] Document target boundaries, data requirements and evaluation limitations.
- [x] Merge script, tests and documentation through PR #88.
- [ ] Confirm applicable hosted CI and review evidence for PR #88;
      the supplied screenshot showed 0 checks and no listed reviews.

The small local diagnostic reported MAE 555.3388 LKR/hour for the global
median and 576.1722 for the category policy. These are exploratory error
amounts, not accuracy percentages, held-out population performance or
evidence supporting deployment. Respondent/employer grouping is unavailable.
The trainer trusts prepared candidate markers; it does not independently
verify all source evidence, consent, dates or payment-period consistency.

### 5.2 Remaining payment-model delivery

- [ ] Agree the live user-facing target, units and supported categories.
- [ ] Distinguish publisher gross-budget suggestions from worker received-pay
      estimates in source contracts and response explanations.
- [ ] Resolve private review records and expand comparable independent data.
- [ ] Implement and evaluate a separate advertised-pay baseline if retained
      in scope; never pool advertisement intervals with actual-pay labels.
- [ ] Establish defensible grouped/time-based training, validation and test data.
- [ ] Add location conditioning where data coverage justifies it.
- [ ] Train and compare regression models when sufficient data is available.
- [ ] Evaluate errors by category, location and time.
- [ ] Evaluate predicted-range coverage and width.
- [ ] Define insufficient-data and unsupported-job behavior.
- [ ] Implement an authorized API with range, currency, pay basis,
      model version and limitations.
- [ ] Integrate publisher suggestions and worker explanations.
- [ ] Define serving metrics, drift checks, retraining gates and rollback.

Offline baseline execution has started. Regression comparison, calibrated
payment ranges, live serving and production readiness remain pending.
Estimates are advisory. Payment Service owns actual commission and payouts.

## 6. Remaining handbook AI backlog

- [ ] Job quality checker.
- [ ] AI-assisted structured job creation with publisher review.
- [ ] Review sentiment and themes.
- [ ] Fake-review detection.
- [ ] Fraud/risk signals for administrator review.
- [ ] Demand forecasting by category/location.
- [ ] Admin model-quality reporting.

Delivery priorities and scope require explicit team agreement.

## 7. ML pipelines and operations

- [x] Record prototype embedding-model and preprocessing versions.
- [x] Verify duplicate and out-of-order synthetic source updates.
- [x] Verify transactional synthetic withdrawals and embedding invalidation.
- [x] Document local prototype execution and database checks.
- [x] Automate synthetic vector database checks.
- [ ] Consume agreed Kafka events.
- [ ] Verify duplicate, delayed and out-of-order delivery through ingestion.
- [ ] Support initial snapshots, reconciliation and rebuilding.
- [ ] Version training datasets, trained models and inference contracts.
- [x] Document and execute the offline baseline training/evaluation command.
- [x] Record the offline model version, input hash and evaluation method.
- [ ] Version production training datasets, schemas and lineage across sources.
- [ ] Define authorized completed-job/payment source APIs or events.
- [ ] Implement ML-owned live projections and point-in-time feature snapshots.
- [ ] Automate validated dataset builds and scheduled candidate training.
- [ ] Define evaluation gates, controlled model promotion and serving reloads.
- [ ] Measure inference latency, failures and quality.
- [ ] Define model rollback and index/storage recovery.
- [ ] Propagate authorized live source updates and deletions.

Helper-level verification does not establish a Kafka ingestion pipeline.
Going live does not automatically train or replace the serving model.
Live collection, retraining, evaluation, release gates, monitoring and rollback
still need implementation. Failed candidates must not replace the serving model.

## 8. Real Auth, gateway and BFF integration

- [x] Provide infrastructure/security feedback on proposed login-attempt,
      recovery, retention and acknowledgement requirements.
- [x] Distinguish isolated gateway verification from real Auth integration.
- [ ] Complete review of the consolidated login-attempt/recovery contract.
- [ ] Resolve proposed credential-storage ownership and encryption/key
      lifecycle requirements.
- [ ] Resolve retention, worker leases, retry bounds, reconciliation,
      backup and restore requirements.
- [ ] Verify relevant Auth implementation and database race-test evidence.
- [ ] Provision separate runtime keys/secrets as required.
- [ ] Connect exact public JWKS routing and approved private operations.
- [ ] Verify TLS, header filtering and no-store behavior with real Auth.
- [ ] Verify no automatic login retries against real Auth.
- [ ] Test assertions, permissions, replay and infrastructure failures.
- [ ] Test JWKS limits, freshness, unknown keys and rotation.
- [ ] Verify complete BFF-gateway-Auth workflows.
- [ ] Document rotation, emergency removal and recovery.

Auth business logic belongs to Member 2.
BFF implementation belongs to Member 1.
Member 4 owns supporting infrastructure and integration verification.

Contract feedback and merged isolated drafts do not approve browser
continuity, credential storage or delivery mechanisms.

## 9. Shared infrastructure and deployment

- [ ] Integrate remaining service and frontend containers.
- [ ] Verify Kafka/Redis access, configuration and failure handling.
- [ ] Add dependency, source-code and container scans.
- [ ] Publish versioned images to the agreed registry.
- [ ] Add staging deployment and validation.
- [ ] Prepare Kubernetes Deployments, Services and Ingress.
- [ ] Configure namespaces, ConfigMaps and runtime secrets.
- [ ] Configure RBAC, network policies and resource requests/limits.
- [ ] Configure readiness/liveness probes for remaining services.
- [ ] Add scaling where justified.
- [ ] Verify controlled migrations and deployment rollback.
- [ ] Test backup restoration and document recovery.
- [ ] Complete the agreed final deployment.

## 10. Monitoring and final delivery

- [ ] Add Prometheus metrics and Grafana dashboards.
- [ ] Add safe centralized logs and actionable alerts.
- [ ] Monitor APIs, authentication failures, databases, Redis, Kafka and ML.
- [ ] Verify integrated recommendations and payment estimation.
- [ ] Run appropriate security, failure and load tests.
- [ ] Complete technical, dataset, model and operational documentation.
- [ ] Prepare reproducible demo data and an end-to-end demonstration.
- [ ] Prepare viva explanations and contribution evidence.

## Definition of Done

Each feature requires:
- A GitHub Issue and documented contracts.
- Implementation with validation and authorization where applicable.
- Appropriate tests and working container configuration.
- No committed secrets and adequate observability.
- A reviewed PR, passing applicable CI and updated documentation.
- Cross-domain integration verification where applicable.

A completed development subtask does not establish completion of its
entire feature. Checklist counts are not a weighted completion percentage.

## Current implementation order

1. Keep planning and source contracts progressing alongside implementation.
2. Reconcile checklist evidence and verify hosted checks for recent PRs.
3. Resolve payment-data review items and expand independent coverage.
4. Define live recommendation and completed-job/payment source contracts.
5. Build/test ingestion and training orchestration with synthetic events first.
6. Integrate authorized live sources and frontend when contracts are ready.
7. Deliver remaining agreed AI features, deployment, hardening and demonstration.

## Immediate next steps

1. Merge this documentation update after checking its evidence and scope.
2. Confirm the relevant CI/review evidence for PR #88.
3. Resolve the private pilot review queue without fabricating missing facts.
4. Agree separate gross-budget and received-pay targets with domain owners.
5. Create implementation Issues for source events, dataset snapshots,
   scheduled training, evaluation gates, promotion, monitoring and rollback.
6. Continue recommendation integration-contract work with Members 1 and 2.

## Evidence references

- [PR #68: isolated vector checks](https://github.com/isuru6106/GigzLK/pull/68)
- [PR #70: retrieved-worker assessments](https://github.com/isuru6106/GigzLK/pull/70)
- [PR #71: retrieved-job assessments](https://github.com/isuru6106/GigzLK/pull/71)
- [PR #73: checklist recovery](https://github.com/isuru6106/GigzLK/pull/73)
- [PR #74: relevance evaluation](https://github.com/isuru6106/GigzLK/pull/74)
- [PR #75: expanded relevance fixtures](https://github.com/isuru6106/GigzLK/pull/75)
- [PR #76: optional suitability filters](https://github.com/isuru6106/GigzLK/pull/76)
- [PR #81: filtered retrieval checks](https://github.com/isuru6106/GigzLK/pull/81)
- [PR #82: recommendation API proposal](https://github.com/isuru6106/GigzLK/pull/82)
- [PR #83: recorded mock-scope decisions](https://github.com/isuru6106/GigzLK/pull/83)
- [PR #84: synthetic frontend fixtures](https://github.com/isuru6106/GigzLK/pull/84)
- [PR #86: survey importer](https://github.com/isuru6106/GigzLK/pull/86)
- [PR #88: offline payment baseline](https://github.com/isuru6106/GigzLK/pull/88)
- [Planning Issue #51](https://github.com/isuru6106/GigzLK/issues/51)
- Repository docs: docs/api/recommendations-v1.md,
  docs/ml/vector-prototype-v1.md, docs/ml/worker-survey-import-v1.md,
  docs/ml/payment-baseline-v1.md and ml-service/evaluation/README.md.

References record the supplied PR, terminal and document evidence.
Merge status is not a substitute for required review, passing CI or live tests.
The private pilot package and its records must remain outside Git history.

Login issuance, refresh and live integration are not approved by this checklist.
Their status is governed by the relevant reviewed contracts and implementation.
