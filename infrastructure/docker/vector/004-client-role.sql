\set ON_ERROR_STOP on

BEGIN;

CREATE ROLE gigzlk_vector_client
    LOGIN
    INHERIT
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOREPLICATION
    NOBYPASSRLS
    CONNECTION LIMIT 5;

GRANT gigzlk_vector_app TO gigzlk_vector_client;

COMMIT;