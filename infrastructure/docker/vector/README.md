# Synthetic vector development database

Owner: Member 4.

This isolated PostgreSQL/pgvector environment supports development with
synthetic jobs and workers. It does not ingest live Job/User data.

## Components

- PostgreSQL 17 with pgvector 0.8.7.
- Separate Compose project and persistent development volume.
- No published host ports.
- Administrator role for schema setup.
- Restricted NOLOGIN application permission role.
- Synthetic source records and 384-dimensional embedding storage.
- Model name, repository revision and preprocessing-version metadata.

The image uses a versioned tag, not an immutable digest.

## Start

Run from the repository root in PowerShell.
The ignored infrastructure/docker/.env must contain ML_DB_PASSWORD.

```powershell
$vectorComposeArgs = @(
    "--env-file", "infrastructure/docker/.env",
    "-f", "infrastructure/docker/compose.vector-dev.yaml"
)

docker compose @vectorComposeArgs config --quiet
if ($LASTEXITCODE -ne 0) { throw "Compose validation failed." }

docker compose @vectorComposeArgs up -d --wait
if ($LASTEXITCODE -ne 0) { throw "Vector database startup failed." }
```

## Initialize a fresh database

Apply these scripts in order:

1. 001-bootstrap.sql
2. 002-synthetic-schema.sql
3. 003-synthetic-fixtures.sql

For each file:

```powershell
Get-Content -Raw infrastructure/docker/vector/001-bootstrap.sql |
    docker compose @vectorComposeArgs exec -T vector-db `
        psql -X -v ON_ERROR_STOP=1 `
        -U gigzlk_vector_admin `
        -d gigzlk_vector_dev

if ($LASTEXITCODE -ne 0) { throw "Database initialization failed." }
```

Replace the filename for each subsequent script.

Bootstrap is repeatable. Schema and fixture scripts intentionally reject
reapplication. They are manually applied development scripts; an automatic
migration runner is not implemented.

Do not rerun initialization against an already initialized volume.

## Verification

Run both repeatable checks:

```powershell
foreach ($check in @(
    "check-synthetic-schema.sql",
    "check-synthetic-embeddings.sql"
)) {
    Get-Content -Raw "infrastructure/docker/vector/$check" |
        docker compose @vectorComposeArgs exec -T vector-db `
            psql -X -v ON_ERROR_STOP=1 `
            -U gigzlk_vector_admin `
            -d gigzlk_vector_dev

    if ($LASTEXITCODE -ne 0) { throw "Check failed: $check" }
}
```

Checks execute as the restricted permission role and roll back their
temporary records.

Verified locally:

- Seven synthetic fixtures are present.
- Hidden, unknown and deleted source records cannot retain searchable text.
- Visible records require non-blank text.
- Entity kinds and synthetic identifier prefixes must agree.
- Valid 384-dimensional embeddings can be stored.
- Identical vectors have approximately zero cosine distance.
- Incorrect dimensions and zero vectors are rejected.
- Embeddings cannot reference a nonexistent source revision.

A separate bootstrap probe verified that the permission role cannot
create tables in the ml schema.

## Boundaries and pending work

- Source revisions are prototype integers, not an accepted live contract.
- The application role has no login credentials yet.
- Numerical test vectors are not model-generated semantic embeddings.
- Model registration metadata is not proof of model provenance.
- Retrieval, visibility enforcement and source-update processing are pending.
- Withdrawal must remove embeddings as well as searchable source text.
- Stale-update prevention, tombstone handling and rebuild safety are pending.
- Embedding-model integration and language/relevance evaluation are pending.
- Automated CI verification is pending.

Recommendations do not establish eligibility or authorize assignment.
Live source ingestion and frontend integration remain disconnected.

## Stop

```powershell
docker compose @vectorComposeArgs down
```

This preserves the development database volume.