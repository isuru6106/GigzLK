# Job and worker recommendation contract

Status: PROPOSED — not implemented or approved for live integration
Owner: Member 4
Reviewers: Members 1, 2 and 3
Tracking issue: #51

## 1. Scope

The first recommendation milestone supports:
- Relevant job suggestions for a worker.
- Relevant worker suggestions for a publisher's job.
- Semantic candidate retrieval followed by explainable matching.

Initial development uses explicitly labelled synthetic fixtures.
Live source integration requires reviewed contracts and authorization.

Salary prediction and emergency assignment are separate features.
Emergency candidate recommendations may reuse this foundation later.

## 2. Existing implementation

POST /api/v1/ml/match assesses one supplied job–worker pair.

Current job inputs:
- job_id
- required_skills: at least one non-empty string
- minimum_experience_months: non-negative integer
- starts_at and ends_at: timezone-aware timestamps
- remote: boolean
- location_id: required for onsite jobs

Current worker inputs:
- worker_id
- skills: optional
- relevant_experience_months: optional
- available_from and available_until: both supplied or both absent
- location_id: optional

Job and availability intervals require end after start.
Unexpected request fields are rejected.

The rules-v1 scorer uses:
- Skills: 50%
- Experience: 20%
- Availability: 20%
- Location: 10%

This baseline does not perform semantic retrieval or establish business
eligibility. Its score is not a hiring probability.

The existing snapshot models remain unchanged by this document.
Recommendation inputs require separate reviewed schemas.

## 3. Ownership

Member 2:
- Authoritative job and worker profile data.
- Job visibility, publication and application-deadline policies.
- Authorization to request or disclose candidate information.
- Canonical identifiers and approved source API/event contracts.
- Rules for deriving experience relevant to a particular job.

Member 3:
- Operational schedules, attendance and emergency replacement workflow.
- Operational conflict checks and emergency offer coordination.

Member 4:
- ML-owned recommendation projections and vector storage.
- Embeddings, retrieval, ranking, explanations and evaluation.
- Projection updates, deletion and rebuilding.

Member 1:
- Recommendation UI and safe response mapping.
- Loading, empty, incomplete and unavailable states.

Application and Contract domain checks remain authoritative.
Recommendations never authorize an application, offer or assignment.

## 4. Proposed source data

All additional fields below are proposals, not verified backend fields.

### Job projection

| Information | Purpose |
|---|---|
| Stable job ID | Source identity |
| Source revision | Update ordering and stale-result detection |
| Title and approved description | Semantic retrieval |
| Category and canonical skills | Retrieval and matching |
| Minimum relevant experience | Existing scoring |
| Start/end timestamps | Schedule compatibility |
| Remote flag and location | Filtering and matching |
| Application deadline | Exclude expired opportunities |
| Discoverability decision/state | Exclude hidden or unpublished jobs |
| Updated timestamp | Diagnostics and reconciliation |

Member 2 must confirm exact fields, status values, revision semantics
and the policy determining whether a job can be recommended.

### Worker projection

| Information | Purpose |
|---|---|
| Stable worker ID | Source identity |
| Source revision | Update ordering and stale-result detection |
| Approved professional summary | Semantic retrieval |
| Canonical skills | Retrieval and matching |
| Relevant experience information | Job-specific experience derivation |
| Explicit availability intervals | Schedule compatibility |
| Location and approved preferences | Filtering and matching |
| Discoverability decision/state | Restrict profile disclosure |
| Updated timestamp | Diagnostics and reconciliation |

A single global experience total must not automatically be treated as
experience relevant to every job.

Separate available periods must not be merged across unavailable gaps.
Missing availability is not evidence that a worker is available.

Do not ingest passwords, tokens, banking information, contact details
or private profile content.

## 5. Identifiers and timestamps

Proposed rules:
- Preserve authoritative entity IDs without case normalization.
- Canonical skill/location identifier formats remain OPEN.
- Keep display labels separate from canonical identifiers.
- Use timezone-aware timestamps and normalize instants to UTC.
- Use source-issued revisions for ordering where available.
- Do not assume timestamps alone establish reliable event ordering.

The current scorer's trim/casefold behavior for skills and locations
must be reconciled with the agreed canonical identifier policy before
live integration. Entity IDs must not use that normalization.

## 6. Retrieval and ranking

Proposed sequence:
1. Authenticate the caller and authorize the recommendation request.
2. Obtain the approved query snapshot.
3. Restrict retrieval to authorized, discoverable candidates.
4. Retrieve semantically relevant candidates.
5. Apply agreed structured filters.
6. Assess supported job–worker factors using the existing scorer.
7. Return bounded, explained suggestions.
8. Revalidate authoritative visibility before disclosing results.

Semantic similarity and rules-v1 scores remain distinct.
Their combination and ordering policy require evaluation and agreement.

Incomplete profiles must not receive an invented complete score.
Unknown data must remain distinguishable from known mismatches.

If visibility cannot be established, omit the candidate or return an
operational failure according to the agreed API policy.

Backend services must recheck eligibility, capacity and commitments
when an application, offer or assignment is attempted.

## 7. Proposed recommendation responses

Each result should contain:
- Candidate job ID or worker ID.
- Rank.
- Source revision used.
- Existing factor assessment where applicable.
- Missing fields and safe explanations.
- Method, scoring version and embedding-model version.
- Snapshot/index timestamp or equivalent freshness metadata.

Response-level information should include:
- Results.
- Returned count.
- Safe warnings.
- Pagination/continuation information if required.

Exact names, limits and HTTP schemas remain OPEN.

Do not return embeddings, private source text or contact details.
Frontend display fields must be authorized and explicitly agreed.

No results is different from retrieval infrastructure being unavailable.
Results must not be described as confirmed eligible workers or jobs.

## 8. Updates, deletion and source consistency

Proposed requirements:
- APIs/events are the integration boundary; no cross-service DB access.
- Authenticate and authorize source ingestion.
- Validate source identity, schema version and revision.
- Process duplicate deliveries idempotently.
- Ignore older updates using agreed source ordering.
- Apply visibility changes and deletions to recommendation projections.
- Keep ordering/tombstone information sufficient to prevent stale
  events or rebuilds from restoring deleted or hidden records.
- Remove associated searchable text and embeddings when required.
- Support initial snapshots and reconciliation with authoritative sources.
- Switch rebuilt indexes only after validation.
- Keep embedding-model versions separate during migrations.

Event names, delivery guarantees, source revisions, reconciliation APIs,
retention periods and acceptable freshness remain OPEN.

## 9. Initial evaluation

Compare semantic recommendations with a simple keyword or skills baseline.

Use reviewed relevance examples covering:
- Related skills expressed with different wording.
- Unrelated candidates.
- Location and schedule compatibility.
- Missing data.
- New workers without work history.
- Hidden, expired, updated and deleted source entities.
- Required languages, including Sinhala/English if in scope.

Report suitable ranking metrics such as Precision@K and NDCG@K,
alongside structured-filter and visibility correctness.

Synthetic fixtures verify behavior, not real-world recommendation quality.
Training or evaluation datasets require documented provenance.

## 10. Decisions required before integration

Member 2:
- Source fields, IDs, discoverability policies and experience derivation.
- Authorized source and recommendation caller contracts.
- Update/deletion revisions, snapshot and reconciliation mechanisms.

Member 1:
- Result fields, explanations, pagination and UI states.
- Display distinction between similarity, suitability and eligibility.

Member 3:
- Future emergency matching inputs and operational boundaries.

Member 4:
- Vector storage and embedding-model selection.
- Measured language support and resource requirements.
- Ranking policy, retrieval bounds and freshness implementation.

No source endpoint, event name or authentication mechanism is invented
or approved by this document.

## 11. Acceptance and implementation status

Issue #51 tracks planning and contract review.
Technical selections may proceed with synthetic fixtures while source
contracts are reviewed.

This document does not approve live data ingestion or integration.
Record reviewer decisions and unresolved items explicitly.

## 12. Cross-member review record

These reviews support synthetic-fixture development.
They do not approve live source contracts or integration.

### Member 1 — frontend direction

Accepted direction:
- Explain recommendations using safe text and structured reason codes.
- Distinguish missing information from known mismatches.
- Show known factors even when the overall assessment is incomplete.
- Keep reputation separate from job-specific suitability.
- Preserve ordinary browsing when recommendations are unavailable.
- Require authorized display data; an ML-returned ID does not grant
  permission to retrieve private profile information.
- Recheck authoritative eligibility when an action is submitted.

Proposed response requirements:
- Candidate ID, rank and source revision.
- Assessment status, nullable suitability score and factor assessments.
- Explanation codes, safe explanation text and missing-field identifiers.
- Method, scoring version, embedding-model version and freshness metadata.
- Response fields: items, nextCursor, hasMore, generatedAt, warnings
  and a result-set identifier.

Exact schemas and authorized display composition remain OPEN.

Required UI states:
- Initial loading and loading another page.
- Empty results.
- Incomplete assessment.
- Temporary unavailability.
- Stale results.
- Unauthorized access.

Partial results require an explicit reviewed contract.

### Member 2 — source boundaries

Member 2 supports synthetic-fixture development and separate ML projections.

No implemented Job/User/profile source was identified in the checkout
reviewed. Implementation on another branch or repository is unverified.

Auth account IDs use UUIDs. This does not establish the identifier format
or account relationship of future worker profiles.

worker_id denotes the worker entity assessed by ML.
Whether it maps to an Auth account or a separate profile remains OPEN.
Synthetic IDs must not be presented as verified production identifiers.

The following remain OPEN:
- Job/User source schemas and entity relationships.
- Canonical skill/location identifiers and normalization policies.
- Discoverability, caller authorization and disclosure policies.
- Job-specific experience derivation, including overlapping periods,
  evidence sources and unknown versus zero values.
- Source revisions, event/API contracts and idempotent processing.
- Visibility withdrawal, deletion, tombstone retention and reconciliation.
- Source freshness and visibility-failure behavior.

Opaque identifiers must not be trimmed or case-normalized unless their
owning contract explicitly permits it.

Missing availability remains unknown.

### Member 3 — emergency boundary

Accepted ownership direction:
- Member 4 retrieves and ranks replacement candidates.
- Member 3 coordinates no-show escalation, operational conflict checks,
  replacement requests and urgent offers.
- Member 2 owns authoritative contract, offer, assignment and identifier
  rules within the relevant domains.

A recommendation neither reserves a worker nor confirms a replacement.

Future emergency inputs may include:
- Original assignment ID and job ID.
- Remaining work interval and latest acceptable arrival time.
- Required skills, location/remote status and excluded workers.
- Authoritative replacement budget and worker net amount.
- Emergency opt-in, availability, travel distance and minimum payment.

Exact schemas and preference-storage ownership remain OPEN.

Missing opt-in or availability must not be interpreted as consent.
Distance and ETA require an identified source and uncertainty information.
Semantic similarity must not be used to invent distance or ETA.
Avoid unnecessary disclosure of precise personal location.

Confirmation must:
- Recheck eligibility, availability, commitments, preferences and budget.
- Recheck remaining capacity.
- Require an unexpired offer and explicit worker acceptance.
- Prevent concurrent confirmations filling the same replacement slot.
- Preserve the original assignment and attendance history.

Replacement funding, cancellation, disputes, refunds and releases remain
separate Member 3 workflows. Recommendations must not automatically
declare a no-show or impose a penalty.

Emergency Operations and matching integration are not implemented by
this proposal.

## 13. Member 4 proposed initial behavior

These defaults are proposals for the next implementation milestone,
not additional cross-member acceptance.

### Scores and explanations

- Preserve the existing rules-v1 suitability scale: 0 to 100.
- Keep an incomplete overall assessment null.
- Show known factor assessments and explicit missing-field identifiers.
- Keep semantic similarity internal initially.
- Use existing scoring reason codes where applicable.
- Define additional recommendation codes before exposing them.
- Do not claim that semantic similarity or suitability establishes
  eligibility, reputation or hiring probability.

### Pagination

Target opaque cursor pagination:
- Default page size: 20.
- Maximum requested page size: 100.
- These are response limits, not finalized vector retrieval limits.

Before implementing cursors, define:
- Binding to the authorized caller, query and filters.
- Ranked result-set identity and ordering.
- Fixed expiry and restart behavior.
- Integrity protection and storage ownership.
- Visibility revalidation on every page.

A ranked snapshot cannot preserve permission to disclose a candidate.
The frontend resets pagination when filters change, deduplicates by
candidate ID and ignores responses for superseded queries.

Cursor lifetime, candidate retrieval budget and pagination storage remain OPEN.

### Failure and freshness behavior

Initial implementation does not support partial-success responses.

- A successful search with no candidates returns an empty result set.
- Infrastructure failure returns an explicit unavailable outcome.
- Missing assessment data does not become a zero score.
- Unknown visibility never authorizes disclosure.
- A failed required visibility check must not be disguised as an
  empty-success response.
- Successful authoritative denial may exclude a candidate.
- Stale results must not imply current availability or eligibility.

Exact error schemas, freshness thresholds and live visibility mechanisms
remain OPEN.

### Independent development

Synthetic fixtures may model:
- Visible and hidden candidates.
- Expired jobs.
- Missing skills, experience and availability.
- Source updates, deletion and out-of-order delivery.
- Related wording and unrelated descriptions.

Fixtures must be clearly labelled and contain no real personal data.
They establish implementation behavior, not production source compatibility
or real-world recommendation accuracy.

## 14. Next milestone

Implement and evaluate a local semantic recommendation prototype using
synthetic job and worker fixtures.

Technical work may proceed while source contracts remain under review.
Do not enable live ingestion or expose private worker information.

Issue #51 remains open for unresolved planning and source-contract items.