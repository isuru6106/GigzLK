\set ON_ERROR_STOP on

BEGIN;

-- Prototype source revisions are positive integers.
-- This does not define the future Job/User source contract.
CREATE TABLE ml.synthetic_entities (
    entity_kind text NOT NULL
        CHECK (entity_kind IN ('job', 'worker')),

    entity_id text NOT NULL
        CHECK (
            entity_id ~ '^synthetic-(job|worker)-[a-z0-9-]+$'
        ),

    source_revision bigint NOT NULL
        CHECK (source_revision > 0),

    visibility text NOT NULL
        CHECK (
            visibility IN ('visible', 'hidden', 'unknown', 'deleted')
        ),

    searchable_text text,

    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (entity_kind, entity_id),

    UNIQUE (entity_kind, entity_id, source_revision),

    CHECK (
        (entity_kind = 'job' AND entity_id LIKE 'synthetic-job-%')
        OR
        (entity_kind = 'worker' AND entity_id LIKE 'synthetic-worker-%')
    ),

    CHECK (
        (
            visibility = 'visible'
            AND searchable_text IS NOT NULL
            AND length(btrim(searchable_text)) BETWEEN 1 AND 10000
        )
        OR
        (
            visibility <> 'visible'
            AND searchable_text IS NULL
        )
    )
);

CREATE TABLE ml.embedding_models (
    model_version text PRIMARY KEY
        CHECK (length(btrim(model_version)) BETWEEN 1 AND 200),

    model_name text NOT NULL
        CHECK (length(btrim(model_name)) BETWEEN 1 AND 200),

    -- Record the downloaded model's exact repository commit.
    model_revision text NOT NULL
        CHECK (model_revision ~ '^[0-9a-f]{40}$'),

    dimensions integer NOT NULL CHECK (dimensions = 384),

    preprocessing_version text NOT NULL
        CHECK (length(btrim(preprocessing_version)) BETWEEN 1 AND 100),

    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ml.synthetic_embeddings (
    entity_kind text NOT NULL,
    entity_id text NOT NULL,
    source_revision bigint NOT NULL,

    model_version text NOT NULL
        REFERENCES ml.embedding_models (model_version),

    embedding public.vector(384) NOT NULL
        CHECK (public.vector_norm(embedding) > 0),

    embedded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (entity_kind, entity_id, model_version),

    FOREIGN KEY (entity_kind, entity_id, source_revision)
        REFERENCES ml.synthetic_entities (
            entity_kind, entity_id, source_revision
        )
        ON DELETE CASCADE
);

COMMIT;