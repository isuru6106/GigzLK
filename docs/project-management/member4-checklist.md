# Member 4 delivery checklist

Owner: Member 4 — AI/ML and Platform Engineering

This checklist tracks the team-handbook scope and agreed follow-up work.
Checked items describe verified foundations, not completed live integration.
Update statuses only when supporting evidence is available.

## 1. Verified foundations

- [x] Explainable rule-based job–worker matching API.
- [x] Request validation and missing-data handling.
- [x] Matching baseline: 67 tests passed.
- [x] ML dependency locks, Docker build and health checks.
- [x] Local PostgreSQL, Redis and Kafka foundation.
- [x] Private Auth Compose runtime and controlled migration task.
- [x] ML, Auth and gateway CI foundations.
- [x] Isolated gateway routing, TLS, headers and body forwarding.
- [x] Gateway failure, retry and body-limit checks: 19 tests passed.
- [x] Platform/authentication reviews completed to the agreed stages.

## 2. Planning and integration contracts

- [x] Merge this checklist through PR #52.
- [ ] Create implementation Issues with acceptance criteria and dependencies.
- [ ] Agree final assessed AI scope, priorities and milestones.
- [ ] Confirm Job/User fields, identifiers and authorized API/event contracts.
- [ ] Confirm recommendation/search response requirements with Member 1.
- [ ] Agree emergency matching inputs and ownership with Member 3.
- [ ] Define supported languages and initial job categories.
- [ ] Define payment prediction target, units and supported categories.
- [ ] Define data access, permitted uses, retention and deletion.

## 3. Vector search and recommendations

- [ ] Select and configure ML-owned vector storage.
- [ ] Select an embedding model; assess languages, licence and resources.
- [ ] Prepare labelled synthetic fixtures and relevance examples.
- [ ] Generate job and worker embeddings.
- [ ] Store entity IDs, source versions and embedding-model versions.
- [ ] Implement indexing, updates, deletion and rebuilding.
- [ ] Build job suggestions for workers.
- [ ] Build worker suggestions for publishers.
- [ ] Combine semantic retrieval with the existing matching scorer.
- [ ] Apply visibility/suitability filters and preserve backend eligibility checks.
- [ ] Build semantic/natural-language search with structured filters.
- [ ] Explain results without treating similarity as hiring probability.
- [ ] Handle empty results, missing data and infrastructure failures.
- [ ] Evaluate relevance against a simple baseline.
- [ ] Integrate backend APIs and frontend.
- [ ] Extend retrieval for emergency replacement candidates.

Member 4 recommends emergency candidates.
Member 3 coordinates the workflow with the relevant domain owners.
Final assignment requires authoritative checks and worker acceptance.

## 4. Real-data collection

- [ ] Finalize and pilot the English/Sinhala worker survey.
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

- [ ] Consume agreed Kafka events.
- [ ] Handle duplicate, delayed and out-of-order events.
- [ ] Support initial indexing, reconciliation and rebuilding.
- [ ] Version datasets, models, embeddings and inference contracts.
- [ ] Document reproducible training and evaluation.
- [ ] Measure inference latency, failures and quality.
- [ ] Define model rollback and index/storage recovery.
- [ ] Propagate authorized source updates and deletions.

## 8. Real Auth, gateway and BFF integration

- [ ] Review the consolidated login-attempt/recovery contract.
- [ ] Review credential-response retention only if proposed.
- [ ] Provision separate runtime keys/secrets as required.
- [ ] Connect exact public JWKS routing and approved private operations.
- [ ] Verify TLS, header filtering and no-store behavior.
- [ ] Verify no automatic login retries against real Auth.
- [ ] Test assertions, permissions, replay and infrastructure failures.
- [ ] Test JWKS limits, freshness, unknown keys and rotation.
- [ ] Verify complete BFF–gateway–Auth workflows.
- [ ] Document rotation, emergency removal and recovery.

Auth business logic belongs to Member 2.
BFF implementation belongs to Member 1.
Member 4 owns supporting infrastructure and integration verification.

## 9. Shared infrastructure and deployment

- [ ] Integrate remaining service and frontend containers.
- [ ] Verify Kafka/Redis access, configuration and failure handling.
- [ ] Add dependency, source-code and container scans.
- [ ] Publish versioned images to the agreed registry.
- [ ] Add staging deployment and validation.
- [ ] Prepare Kubernetes Deployments, Services and Ingress.
- [ ] Configure namespaces, ConfigMaps and runtime secrets.
- [ ] Configure RBAC, network policies and resource requests/limits.
- [ ] Configure readiness/liveness probes.
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
- A reviewed PR, passing CI and updated documentation.
- Cross-domain integration verification where applicable.

## Current implementation order

1. Planning and contracts.
2. Vector search and recommendations.
3. Real-data collection alongside recommendation development.
4. Payment estimation after data-quality assessment.
5. Remaining AI features in the agreed priority order.
6. Integration/platform work alongside available services.
7. Final deployment, hardening and demonstration.

Login issuance, refresh and live integration are not approved by this checklist.
Their status is governed by the relevant reviewed contracts and implementation.