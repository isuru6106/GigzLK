\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE gigzlk_vector_app;

-- Numerical database tests only.
-- This is not a downloaded model or a semantic-quality evaluation.
INSERT INTO ml.embedding_models (
    model_version,
    model_name,
    model_revision,
    dimensions,
    preprocessing_version
)
VALUES (
    'synthetic-database-probe-v1',
    'TEST_ONLY_NOT_A_REAL_MODEL',
    repeat('0', 40),
    384,
    'synthetic-numerical-probe-v1'
);

INSERT INTO ml.synthetic_entities (
    entity_kind,
    entity_id,
    source_revision,
    visibility,
    searchable_text
)
VALUES (
    'job',
    'synthetic-job-embedding-probe',
    1,
    'visible',
    'Synthetic database probe only.'
);

DO $$
DECLARE
    valid_vector public.vector(384);
    stored_dimensions integer;
    self_distance double precision;
BEGIN
    valid_vector :=
        ('[1' || repeat(',0', 383) || ']')::public.vector;

    INSERT INTO ml.synthetic_embeddings (
        entity_kind,
        entity_id,
        source_revision,
        model_version,
        embedding
    )
    VALUES (
        'job',
        'synthetic-job-embedding-probe',
        1,
        'synthetic-database-probe-v1',
        valid_vector
    );

    SELECT
        public.vector_dims(embedding),
        embedding OPERATOR(public.<=>) valid_vector
    INTO stored_dimensions, self_distance
    FROM ml.synthetic_embeddings
    WHERE entity_kind = 'job'
      AND entity_id = 'synthetic-job-embedding-probe'
      AND model_version = 'synthetic-database-probe-v1';

    IF stored_dimensions IS DISTINCT FROM 384 THEN
        RAISE EXCEPTION 'Expected 384 embedding dimensions';
    END IF;

    IF self_distance IS NULL OR abs(self_distance) > 0.000001 THEN
        RAISE EXCEPTION 'Identical-vector distance check failed';
    END IF;

    -- Wrong dimensions must be rejected.
    BEGIN
        UPDATE ml.synthetic_embeddings
        SET embedding = '[1,0,0]'::public.vector
        WHERE entity_id = 'synthetic-job-embedding-probe';

        RAISE EXCEPTION 'Wrong dimensions unexpectedly accepted';
    EXCEPTION
        WHEN data_exception THEN NULL;
    END;

    -- Zero vectors cannot support useful cosine retrieval.
    BEGIN
        UPDATE ml.synthetic_embeddings
        SET embedding =
            ('[0' || repeat(',0', 383) || ']')::public.vector
        WHERE entity_id = 'synthetic-job-embedding-probe';

        RAISE EXCEPTION 'Zero vector unexpectedly accepted';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    -- The embedding must reference an existing source revision.
    BEGIN
        UPDATE ml.synthetic_embeddings
        SET source_revision = 2
        WHERE entity_id = 'synthetic-job-embedding-probe';

        RAISE EXCEPTION 'Unknown source revision unexpectedly accepted';
    EXCEPTION
        WHEN foreign_key_violation THEN NULL;
    END;

    RAISE NOTICE 'Embedding dimension, distance, zero-vector and revision checks passed.';
END
$$;

-- Remove every test record, including the placeholder model.
ROLLBACK;