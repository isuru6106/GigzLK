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

- Physical removal of withdrawn embeddings.
- Versioned update/deletion handling and stale-event protection.
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