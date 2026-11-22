\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE gigzlk_vector_app;

DO $$
DECLARE
    fixture_count integer;
BEGIN
    SELECT count(*) INTO fixture_count
    FROM ml.synthetic_entities
    WHERE entity_id IN (
        'synthetic-job-cafe-assistant',
        'synthetic-job-python-data',
        'synthetic-worker-hospitality',
        'synthetic-worker-python',
        'synthetic-worker-hidden',
        'synthetic-worker-unknown',
        'synthetic-job-deleted'
    );

    IF fixture_count <> 7 THEN
        RAISE EXCEPTION 'Expected seven synthetic fixtures';
    END IF;

    -- Withdrawn or unknown records must not retain searchable text.
    BEGIN
        INSERT INTO ml.synthetic_entities
        VALUES (
            'worker',
            'synthetic-worker-invalid-hidden-probe',
            1,
            'hidden',
            'This text must be rejected',
            CURRENT_TIMESTAMP
        );

        RAISE EXCEPTION 'Hidden text was unexpectedly accepted';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    -- Visible records require non-blank searchable text.
    BEGIN
        INSERT INTO ml.synthetic_entities
        VALUES (
            'job',
            'synthetic-job-invalid-empty-probe',
            1,
            'visible',
            '   ',
            CURRENT_TIMESTAMP
        );

        RAISE EXCEPTION 'Blank visible text was unexpectedly accepted';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    -- Job and worker identifiers must match their entity kind.
    BEGIN
        INSERT INTO ml.synthetic_entities
        VALUES (
            'worker',
            'synthetic-job-invalid-kind-probe',
            1,
            'unknown',
            NULL,
            CURRENT_TIMESTAMP
        );

        RAISE EXCEPTION 'Mismatched identifier was unexpectedly accepted';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    RAISE NOTICE 'Fixture presence and source constraint checks passed.';
END
$$;

ROLLBACK;