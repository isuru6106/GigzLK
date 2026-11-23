# Member 4 delivery checklist

Owner: Member 4 — AI/ML and Platform Engineering

This checklist tracks the team-handbook scope and agreed follow-up work.
Checked items describe evidence-backed work within the stated scope.
Local verification, merged implementation and live integration are distinct.

## 1. Verified foundations

- [x] Explainable rule-based job–worker matching API.
- [x] Request validation and missing-data handling.
- [x] Original matching baseline: 67 tests passed.
- [x] Base ML dependency locks, Docker build and health checks.
- [x] Local PostgreSQL, Redis and Kafka foundation.
- [x] Private Auth Compose runtime and controlled migration task.
- [x] ML, Auth and gateway CI foundations.
- [x] Isolated gateway routing, TLS, headers and body forwarding.
- [x] Gateway failure, retry and body-limit checks: 19 tests passed.
- [x] Platform/authentication reviews completed to the recorded stages.

Latest local ML suite: 143 tests passed.
This includes the original baseline and new recommendation-assessment tests.

## 2. Planning and integration contracts

- [x] Merge the delivery checklist through PR #52.
- [x] Create planning Issue #51 with acceptance criteria.
- [x] Document existing matching inputs and limitations.
- [x] Record Members 1–3's recommendation reviews and unresolved decisions.
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

### 3.3 Retrieved-worker assessments — merged in PR #70

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

### 3.4 Retrieved-job assessments — locally verified, PR pending

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
- [ ] Commit and push the job-assessment branch.
- [ ] Open and review the job-assessment PR.
- [ ] Verify ML service CI and Synthetic vector checks for this change.
- [ ] Merge the job-assessment PR.

Current branch: feat/member4-job-recommendation-assessments.

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
- [ ] Verify the newly added retrieved-job assessment in CI.

### 3.6 Remaining recommendation delivery

- [ ] Expand reviewed synthetic relevance examples and candidate coverage.
- [ ] Evaluate semantic retrieval against a keyword/skills baseline.
- [ ] Report ranking metrics such as Precision@K and NDCG@K.
- [ ] Define and evaluate suitability filtering and combined ranking policy.
- [ ] Build semantic/natural-language search with structured filters.
- [ ] Finalize explanation codes, freshness metadata and response contracts.
- [ ] Define empty, incomplete, stale, partial and unavailable behavior.
- [ ] Implement recommendation HTTP APIs.
- [ ] Implement caller authorization and authoritative disclosure checks.
- [ ] Revalidate visibility and freshness before live disclosure.
- [ ] Preserve authoritative backend eligibility checks on submitted actions.
- [ ] Integrate authorized backend source APIs/events.
- [ ] Integrate Member 1's frontend.
- [ ] Extend retrieval for emergency replacement candidates.

Current assessment order follows semantic similarity.
Attaching rules-v1 assessments does not implement a combined ranking score.

Synthetic tests verify behavior, not real-world relevance or hiring outcomes.
There is no completed live recommendation HTTP API or frontend integration.

Member 4 retrieves and assesses emergency candidates.
Member 3 coordinates the operational workflow with domain owners.
Final assignment requires authoritative checks and worker acceptance.

## 4. Real-data collection

- [x] Prepare English/Sinhala worker-survey question content.
- [ ] Finalize and pilot the survey.
- [ ] Add actual contact, retention and required consent details.
- [ ] Publish the survey and collect responses.
- [ ] Request anonymized completed-job records from employers.
- [ ] Create the dataset schema and collection sheet.
- [ ] Select Sri Lankan job sources and check permitted collection/reuse.
- [ ] Prefer authorized APIs or research exports.
- [ ] Build and validate one permitted website collector.
- [ ] Add browser automation where necessary and permitted.
- [ ] Add AI-assisted extraction and summaries.
- [ ] Preserve source references, dates and original payment evidence.
- [ ] Distinguish advertised, agreed and actually paid amounts.
- [ ] Record units, per-worker/team basis, hours, deductions and expenses.
- [ ] Preserve unknown values and remove unnecessary personal information.
- [ ] Detect duplicates, reposts and suspicious records.
- [ ] Manually assess survey and extraction quality.
- [ ] Version datasets and document provenance, access and retention.
- [ ] Schedule repeat collection only after validation and permission checks.
- [ ] Assess whether coverage supports model training.

A separately trained AI browsing agent is not currently a deliverable.

## 5. Payment estimation

- [ ] Clean and standardize payment records.
- [ ] Define qualifying records and features available at prediction time.
- [ ] Split training, validation and test data without leakage.
- [ ] Build a category/location median baseline.
- [ ] Train and compare regression models.
- [ ] Evaluate errors by category, location and time.
- [ ] Evaluate predicted-range coverage and width.
- [ ] Define insufficient-data and unsupported-job behavior.
- [ ] Build the API with range, currency, pay basis, version and limitations.
- [ ] Integrate publisher suggestions and worker explanations.
- [ ] Define monitoring, retraining and rollback.

Payment-model training has not started.
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
- [ ] Document reproducible training and evaluation.
- [ ] Measure inference latency, failures and quality.
- [ ] Define model rollback and index/storage recovery.
- [ ] Propagate authorized live source updates and deletions.

Helper-level verification does not establish a Kafka ingestion pipeline.

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
- [ ] Verify complete BFF–gateway–Auth workflows.
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

1. Planning/contracts continue alongside implementation.
2. Vector search and recommendations are the current main development area.
3. Real-data collection proceeds alongside recommendation development.
4. Payment estimation follows data-quality assessment.
5. Remaining AI features follow the agreed priority order.
6. Integration/platform work proceeds alongside available services.
7. Final deployment, hardening and demonstration.

## Immediate next steps

1. Commit, push and open the current job-assessment PR.
2. Verify both applicable workflows and complete review before merging.
3. Expand recommendation fixtures and baseline relevance evaluation.
4. Define and evaluate suitability filtering and ranking behavior.
5. Finalize and implement recommendation API contracts.
6. Connect authorized live sources and frontend when contracts are ready.
7. Continue survey preparation and real payment-data collection.

Login issuance, refresh and live integration are not approved by this checklist.
Their status is governed by the relevant reviewed contracts and implementation.