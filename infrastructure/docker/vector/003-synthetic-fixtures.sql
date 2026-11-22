\set ON_ERROR_STOP on

BEGIN;

-- Development fixtures only. These are not real people or jobs.
-- Visibility values do not represent a live authorization contract.

INSERT INTO ml.synthetic_entities (
    entity_kind,
    entity_id,
    source_revision,
    visibility,
    searchable_text
)
VALUES
(
    'job',
    'synthetic-job-cafe-assistant',
    1,
    'visible',
    'Part-time cafe assistant preparing drinks, serving customers '
    'and keeping the counter clean.'
),
(
    'job',
    'synthetic-job-python-data',
    1,
    'visible',
    'Part-time Python developer cleaning CSV files, validating data '
    'and writing automated scripts.'
),
(
    'worker',
    'synthetic-worker-hospitality',
    1,
    'visible',
    'Customer service, food service, drink preparation '
    'and experience assisting in a cafe.'
),
(
    'worker',
    'synthetic-worker-python',
    1,
    'visible',
    'Python programming, CSV processing, data cleaning '
    'and automation scripts.'
),
(
    'worker',
    'synthetic-worker-hidden',
    1,
    'hidden',
    NULL
),
(
    'worker',
    'synthetic-worker-unknown',
    1,
    'unknown',
    NULL
),
(
    'job',
    'synthetic-job-deleted',
    2,
    'deleted',
    NULL
);

COMMIT;