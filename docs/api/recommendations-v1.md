# Recommendation API v1 - proposed contract

Status: PROPOSED - pending review by Members 1 and 2.
Owner: Member 4.
Related planning issue: #51.

This document proposes a recommendation contract for frontend mocks
and future backend integration.

No recommendation HTTP routes are implemented by this document.
Existing synthetic Python assessment models are development helpers,
not approved live request or response contracts.

## 1. Implemented foundations

The synthetic prototype currently supports:

- Job and worker semantic retrieval using PostgreSQL/pgvector.
- Source-revision and embedding-model-version metadata.
- Visibility filtering against the synthetic source projection.
- Rules-v1 assessments of retrieved workers and jobs.
- Optional known availability/location mismatch filters.
- Explicit missing information and mismatch warnings.
- Stable semantic ordering and consecutive filtered ranks.
- Synthetic relevance evaluation against a keyword baseline.
- Database integration checks and automated vector CI.

The full ML unit-test suite currently contains 198 passing tests.

Synthetic tests do not establish live source compatibility,
production relevance, supported-language quality or authorization.

## 2. Proposed operations

These paths and their exposure remain subject to review.

| Operation | Proposed path | Context |
|---|---|---|
| Suggest workers | POST /api/v1/ml/recommendations/workers | One job |
| Suggest jobs | POST /api/v1/ml/recommendations/jobs | One worker |

The marketplace BFF is the proposed caller.

Browser access, gateway routing, service authentication and authorization
must be agreed before enabling these operations.

Clients must not submit arbitrary candidate pools or authoritative
eligibility decisions to these proposed retrieval operations.

The current synthetic assessment helpers accept explicit snapshots
and candidate pools for isolated development. That is a different
interface from the proposed recommendation operations.

## 3. Proposed requests

### Workers for a job

```json
{
  "jobId": "synthetic-job-cafe-example",
  "limit": 20,
  "filters": {
    "excludeAvailabilityMismatch": false,
    "excludeLocationMismatch": false
  }
}
```

### Jobs for a worker

```json
{
  "workerId": "synthetic-worker-service-example",
  "limit": 20,
  "filters": {
    "excludeAvailabilityMismatch": false,
    "excludeLocationMismatch": false
  }
}
```

All example identities are synthetic.

Proposed validation:

- Reject unknown request fields.
- Reject empty or whitespace-only identifiers.
- Preserve opaque identifier values; do not trim or case-normalize them.
- Default limit: 20.
- Maximum limit: 100.
- Limit must be a positive integer; booleans are invalid.
- Filters are optional and default to false.
- Filter values must be JSON booleans.
- Reject unsupported filters.

These response limits are proposals.
The current database demonstration retrieves at most five candidates.
Live retrieval budgets, oversampling and refill behavior remain OPEN.

The caller-supplied identifier does not establish ownership or permission.
The serving layer must authorize access to the subject and candidates.

The live identifier formats and worker-to-account relationship remain OPEN.

## 4. Proposed response envelope

Frontend-facing fields use camelCase in this proposal.

Current Python models use snake_case.
An explicit, tested adapter would be required before exposing this contract.

| Field | Proposed meaning |
|---|---|
| contractVersion | Contract identifier: recommendations-v1 |
| direction | WORKERS_FOR_JOB or JOBS_FOR_WORKER |
| subject | Subject entity kind, ID and source revision |
| generatedAt | UTC response-generation time |
| rankingVersion | Ordering policy used |
| embeddingModelVersion | Embedding model and preprocessing version |
| filterPolicyVersion | Applied suitability-filter policy |
| appliedFilters | Effective filter values |
| freshness | Verification state of the returned projection |
| items | Ordered recommendation items |
| warnings | Response-level reason codes |

A source revision is not a timestamp or proof of current freshness.
generatedAt describes response generation, not authoritative verification.

For synthetic mocks, freshness is:

```json
{
  "status": "NOT_VERIFIED"
}
```

Live freshness thresholds, required checks and verified freshness
representations remain OPEN.

A live operation must not silently bypass required authorization,
visibility or freshness checks by returning NOT_VERIFIED.

Pagination fields and result-set identity are deliberately not finalized
in this draft. See section 10.

## 5. Proposed recommendation item

Each item contains:

| Field | Meaning |
|---|---|
| rank | Consecutive position starting at 1 |
| candidateId | Worker or job identifier |
| candidateSourceRevision | Source revision used for this candidate |
| assessment | Rules-v1 suitability assessment |

Candidate source revisions are positive integers.

The JSON representation of database bigint revisions remains OPEN.
Before integration, the team must choose a representation that preserves
values beyond JavaScript's safe integer range.

Synthetic frontend fixtures should use small positive revisions.

Semantic similarity is retained internally for ordering.
It is omitted from this proposed frontend response.

An item does not grant permission to load private profile information.

Names, photographs, contact details and other display data must come
from an explicitly authorized composition contract.

Authorized display fields and their owning service remain OPEN.

## 6. Assessment fields

Each assessment contains:

- scoringVersion: rules-v1.
- method: RULE_BASED.
- jobId.
- workerId.
- assessmentStatus: COMPLETE or INCOMPLETE.
- overallScore: number from 0 to 100, or null.
- factors: skills, experience, availability and location.
- missingFields: field identifiers.
- warnings: assessment-level reason codes.

Each factor contains:

- score: number from 0 to 100, or null.
- weight.
- reasonCode.
- explanation.

Existing rules-v1 weights are:

| Factor | Weight |
|---|---:|
| Skills | 0.50 |
| Experience | 0.20 |
| Availability | 0.20 |
| Location | 0.10 |

If any required factor cannot be assessed:

- assessmentStatus is INCOMPLETE.
- overallScore is null.
- Known factor assessments remain available.
- Missing fields are identified explicitly.
- Weights are not redistributed.

Known absence and unknown information remain distinct.
Zero experience must not become null, and unknown experience must not
be replaced with zero.

For job suggestions, experience must be relevant to each candidate job.
A shared worker-wide experience value must not be reused for every job.

The authoritative experience derivation contract remains OPEN.

## 7. Ordering and optional filters

The implemented synthetic policy orders by:

1. Semantic similarity descending.
2. Candidate identifier ascending for ties.

Rules-v1 scores explain suitability separately.
No combined semantic/suitability score is implemented.

The synthetic filter policy is synthetic-known-mismatches-v1.

Both optional filters default to disabled:

- excludeAvailabilityMismatch.
- excludeLocationMismatch.

When enabled, they exclude assessments with the corresponding known
AVAILABILITY_MISMATCH or LOCATION_MISMATCH reason code.

Unknown information is retained.
An incomplete assessment can still contain a known mismatch and may
be excluded by its corresponding enabled filter.

Remaining items preserve their semantic order.
Ranks are renumbered consecutively.

Filters operate on the retrieved candidate pool.
They do not establish domain eligibility or semantic no-match detection.

The live ordering and filtering policies require acceptance.
Evaluation judgments remain DRAFT_UNREVIEWED.

Internal filter summaries include input, returned and excluded counts.
Reason-specific exclusion counts can overlap.

These counts are not included in the proposed frontend response.
Disclosure of counts requires review because they may reveal information
about candidates that are not returned.

## 8. Explanations and frontend behavior

Explanations must describe the supplied evidence and rule outcome.

The frontend must:

- Render explanation text as text, not executable HTML.
- Distinguish unknown information from known mismatches.
- Preserve warnings even when the overall score is high.
- Avoid interpreting scores as hiring probabilities.
- Avoid describing a recommendation as an eligibility decision.
- Keep ordinary browsing available when recommendations are unavailable.
- Ignore responses for superseded requests.
- Obtain display data only through authorized operations.

Required UI mock states:

- Loading.
- Results with complete assessments.
- Results with incomplete assessments.
- Known schedule or location mismatches.
- Empty results.
- Temporary unavailability.
- Unauthorized access.
- Stale or expired result-set behavior once its contract is agreed.

Reputation, payment compatibility and eligibility must not be inferred
from semantic similarity or the current rules-v1 score.

## 9. Empty results and failures

A successful operation with no returned candidates uses items: [].

An empty retrieved or filtered pool does not prove that no suitable
candidate exists elsewhere.

Infrastructure failure must not be converted into empty success.
A failed required visibility check must not be converted into empty success.
Unknown visibility does not authorize disclosure.

Partial-success responses are not supported by this proposal.

Proposed error envelope:

```json
{
  "error": {
    "code": "RECOMMENDATIONS_UNAVAILABLE",
    "message": "Recommendations are temporarily unavailable."
  }
}
```

Proposed status mapping:

| Status | Meaning |
|---|---|
| 200 | Successful recommendation response, possibly empty |
| 401 | Caller authentication is missing or invalid |
| 403 | Caller lacks permission for the operation |
| 422 | Request validation failed |
| 503 | Required recommendation infrastructure or verification is unavailable |

The treatment of missing versus inaccessible subjects remains OPEN.
It must not reveal private entity existence.

Expired cursors and stale result-set error codes remain OPEN.

Errors must not expose database messages, credentials, tokens,
private source records or internal stack traces.

Proposed response handling includes Cache-Control: no-store for both
successful responses and errors.

These status codes, error schemas and header requirements require review
and implementation tests before being treated as operational guarantees.

## 10. Pagination decisions still open

Before adding nextCursor, hasMore or resultSetId, agree:

- Cursor ownership and integrity protection.
- Binding to the authorized caller.
- Binding to the subject, query and filters.
- Ranked result-set identity.
- Fixed expiry and restart behavior.
- Candidate retrieval budgets and refill behavior.
- Visibility and authorization revalidation on every page.
- Source-change behavior between pages.
- Storage limits, retention and cleanup.
- Safe meaning of hasMore after filtering.

Current synthetic assessments do not implement pagination.

Returning fewer than limit items does not establish hasMore: false.

## 11. Authorization and source boundaries

Member 2 and the relevant domain owners retain authoritative checks
for eligibility, capacity, conflicts and permitted actions.

A recommendation does not reserve, assign or accept a worker.

Before an application, offer or assignment is submitted, the owning
backend must recheck its authoritative conditions.

ML must not query another service's private database.

The following remain OPEN:

- Job and worker source schemas.
- Worker identity and account relationships.
- Canonical skill and location identifiers.
- Discoverability and disclosure policies.
- Service authentication and caller authorization.
- Authorized display-data composition.
- Revision and event/API contracts.
- Source freshness and verification failure handling.
- Withdrawal, deletion and tombstone retention.
- Live experience derivation.
- Supported languages and accepted ranking quality.

Existing rules-v1 normalization behavior must not be assumed to define
the future canonical identifier contract.

## 12. Frontend mock scope

Member 1 can use clearly labelled synthetic fixtures to develop:

- Recommendation cards and list states.
- Factor explanations.
- Missing-data indicators.
- Optional filter controls.
- Loading, empty and unavailable states.
- Safe response replacement when the request changes.

Mocks must not imply that live authorization, source verification,
pagination or recommendation HTTP routes already exist.

Mock data must contain no real personal information.

## 13. Review and implementation acceptance

Before enabling live recommendation operations:

- Members 1 and 2 review the request and response contract.
- Resolve source identity, authorization and disclosure requirements.
- Resolve freshness requirements and failure behavior.
- Agree safe source-revision serialization.
- Accept the ranking and filtering policy.
- Define authorized display-data composition.
- Finalize pagination or explicitly agree a bounded non-paginated release.
- Implement schema validation and response adapters.
- Test complete, incomplete, empty and failure responses.
- Test unauthorized and withdrawn-candidate behavior.
- Verify gateway/BFF integration and no-store headers.
- Update operational documentation and the delivery checklist.

Issue #51 remains open for unresolved planning and integration decisions.