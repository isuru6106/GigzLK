# Synthetic vector retrieval prototype

Owner: Member 4.

Status: Local development prototype. No live ingestion or frontend integration.

## Implemented

- CPU embedding generation using intfloat/multilingual-e5-small.
- Exact model revision pinned in ml-service/vector-model.json.
- 384-dimensional normalized embeddings.
- Explicit query and passage prefixes.
- PostgreSQL/pgvector storage through a restricted login.
- Transactional embedding publication with source snapshot revalidation.
- Repeatable upserts by entity and model version.
- Separate job and worker semantic searches.
- Retrieval restricted to visible records with matching source revisions
  and model versions.

The prototype is a command-line demonstration. It does not expose a
recommendation HTTP endpoint or combine results with rules-v1 matching.

## Development environment

Verified locally with Windows and Python 3.13.14.

Dependencies are declared in ml-service/requirements-vector-dev.txt.
Install CPU PyTorch from its official CPU wheel index before installing
that file. Full transitive locking and Linux verification remain pending.

Use the ignored ml-service/.venv-vector environment.

The model check downloads the pinned model into the Hugging Face cache.
The retrieval demo requires that cached model and uses local_files_only.

## Database setup

Initialize the isolated database using the instructions in
infrastructure/docker/vector/README.md.

Then apply 004-client-role.sql once using the administrator role.
Set gigzlk_vector_client's password interactively with psql's \password
command. Never commit the password.

For Python running on the host, start Compose with the optional overlay:

```powershell
$vectorComposeArgs = @(
    "--env-file", "infrastructure/docker/.env",
    "-f", "infrastructure/docker/compose.vector-dev.yaml",
    "-f", "infrastructure/docker/compose.vector-host.yaml"
)

docker compose @vectorComposeArgs config --quiet
if ($LASTEXITCODE -ne 0) { throw "Compose validation failed." }

docker compose @vectorComposeArgs up -d --wait
if ($LASTEXITCODE -ne 0) { throw "Database startup failed." }
```

The overlay publishes only 127.0.0.1:5544.
Python uses gigzlk_vector_client, not the administrator login.

## Run

From the repository root:

```powershell
$vectorPython = ".\ml-service\.venv-vector\Scripts\python.exe"

foreach ($script in @(
    "check-vector-model.py",
    "check-vector-db.py",
    "demo-vector-retrieval.py",
    "check-vector-retrieval.py"
)) {
    & $vectorPython ".\ml-service\scripts\$script"
    if ($LASTEXITCODE -ne 0) { throw "Failed: $script" }
}
```

Database scripts prompt for the dedicated local client password.

## Recorded local verification

- Dependency consistency and import checks passed.
- Model output shape, finite values and normalization checks passed.
- Restricted Python database connection passed.
- Four visible synthetic records received model-generated embeddings.
- Repeat indexing and search completed successfully.
- All four demonstration queries ranked the related fixture first.
- Actual search-function checks excluded hidden, unknown and deleted
  candidates despite retained vectors.
- Model-version isolation and fixture rollback checks passed.

The examples are not a representative relevance benchmark.
Similarity values are not suitability scores, probabilities or eligibility.

## Remaining work

- Connect versioned updates and embedding removal to an authorized ingestion path.
- Agree live revision ordering, tombstone retention and reconciliation contracts.
- Concurrent indexing/update and failure tests.
- Automated duplicate-count assertions for repeat indexing.
- Broader fixtures and relevance evaluation against a simple baseline.
- Sinhala and other required language evaluation.
- Full dependency locks, Linux/container verification and CI.
- Hybrid ranking with the existing matching scorer.
- Authorized source contracts, disclosure checks and freshness policy.
- Recommendation APIs and frontend integration.

Synthetic visibility flags do not establish live authorization.
Backend services remain authoritative for applications, offers and assignment.

## Synthetic source update handling

Implemented in ml-service/scripts/vector_source_updates.py.

- Creates records, including deletion-first tombstones.
- Recognizes identical duplicate revisions.
- Rejects equal revisions containing different data.
- Ignores older revisions.
- Deletes embeddings for every model before applying a newer revision.
- Removes searchable text on hidden, unknown and deleted updates.
- Prevents deleted synthetic identities from being restored.
- Updates source state and deletes embeddings in one transaction.

A newer visible revision requires re-embedding before retrieval.

Run from the repository root:

```powershell
$vectorPython = ".\ml-service\.venv-vector\Scripts\python.exe"

& $vectorPython .\ml-service\scripts\check-vector-source-updates.py
if ($LASTEXITCODE -ne 0) { throw "Source-update checks failed." }

& $vectorPython .\ml-service\scripts\check-vector-source-concurrency.py
if ($LASTEXITCODE -ne 0) { throw "Concurrency checks failed." }
```

Recorded local verification:

- Duplicate, conflicting and stale revisions behaved as specified.
- Newer updates invalidated stored embeddings.
- Withdrawal removed searchable text and embeddings.
- Transaction rollback restored source state and embeddings together.
- Deletion-first delivery and resurrection rejection passed.
- Three consecutive independent-connection concurrency runs passed.

Concurrency testing exposed an unhandled secondary unique-constraint
conflict. The initial insert now uses ON CONFLICT DO NOTHING across
applicable unique constraints before locked revision comparison.

These runs do not exhaust every possible interleaving.
Indexer-versus-withdrawal races remain unverified.

The helper is not connected to an ingestion API or Kafka consumer.
Direct table writes can bypass its update rules. Live source revisions,
authorization, tombstone retention and reconciliation remain pending.

## Transactional publication and withdrawal checks

The synthetic demo uses the shared vector_publication.py helper.
Embedding generation occurs before the publication transaction.

Publication locks source rows in a consistent order and verifies each
source revision, text and visibility against its encoded snapshot.
A changed snapshot rolls back the complete batch, including any new
model registration.

Verified locally using independent PostgreSQL connections and observed
database blocking:
- Hidden, unknown and deleted updates committing first reject publication
  of the old snapshot.
- Publication committing first allows the subsequent withdrawal to
  remove its embedding.
- A newer source revision prevents stale publication.
- A failed batch leaves no partially published embeddings or new model
  registration.

Run from the repository root:

    .\ml-service\.venv-vector\Scripts\python.exe -u .\ml-service\scripts\check-vector-publication-races.py

The checks use synthetic numerical vectors and temporary records.
They do not measure embedding quality. Temporary records are removed
after the checks.

Direct table writes can bypass these helpers. Live source contracts,
ingestion, authorization and frontend integration remain pending.

## Synthetic vector database CI

.github/workflows/vector-checks.yml defines isolated Linux database checks
using Python 3.13 and a fresh PostgreSQL/pgvector container.

The job generates temporary database passwords, applies the bootstrap,
schema, fixtures and restricted-client role, and runs SQL constraints,
retrieval, source-update, concurrency and publication-race checks.

Python checks connect as gigzlk_vector_client. Administrative setup and
SQL permission/constraint checks use the isolated database administrator.

ML_VECTOR_DB_PASSWORD provides non-interactive password input.
Local execution retains the hidden password prompt when the variable is
absent. CI fails immediately if the variable is missing or empty.

Retrieval and source-update checks create their own synthetic numerical
vectors and require no previously indexed embeddings. Database CI uses
requirements-vector-ci-lock.txt without PyTorch or model downloads.

The job verifies temporary-record cleanup and removes its container.
Embedding-model execution, language quality, full vector-development
dependency locking and live integration are outside this workflow.

The first successful GitHub Actions run must be recorded before marking
automated vector CI as verified.

## Synthetic retrieved-worker assessment

app/synthetic_recommendations.py assesses retrieved workers for one job
using the existing assess_match function and rules-v1 scoring.

The current policy preserves descending semantic similarity, with worker
ID breaking ties. It does not combine similarity and suitability into a
single score or rerank candidates by suitability.

Results retain source revisions, embedding-model version, factor
assessments, explanations, missing fields and mismatch warnings.
Incomplete assessments retain a null overall suitability score.

The module accepts synthetic job/worker IDs only, rejects duplicate
candidates and limits each request to 100 candidates.

Verification:
- 34 assessment tests passed locally.
- The complete ML suite passed 101 tests.
- check-vector-worker-assessment.py passed four PostgreSQL integration
  checks using temporary sources and synthetic numerical vectors.
- Checks verified hidden-worker filtering, preserved retrieval metadata,
  complete/incomplete assessments, mismatch warnings and serialization.
- Temporary sources, vectors and model registrations were rolled back.

Structured worker attributes are explicit test fixtures. They are not
inferred from descriptions or supplied by a live source contract.
Relevant experience must apply to the assessed job.

Source freshness, caller authorization, authoritative visibility,
eligibility, recommendation HTTP APIs, job suggestions for workers and
frontend integration remain pending.

The worker-assessment database check is included in the vector workflow.
Its automated execution requires a successful Actions run for this change.