\set ON_ERROR_STOP on

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname = 'gigzlk_vector_app'
    ) THEN
        CREATE ROLE gigzlk_vector_app
            NOLOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOREPLICATION
            NOBYPASSRLS;
    END IF;
END
$$;

REVOKE ALL ON DATABASE gigzlk_vector_dev FROM PUBLIC;
GRANT CONNECT ON DATABASE gigzlk_vector_dev
    TO gigzlk_vector_app;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA IF NOT EXISTS ml;
REVOKE ALL ON SCHEMA ml FROM PUBLIC;
GRANT USAGE ON SCHEMA ml TO gigzlk_vector_app;

ALTER DEFAULT PRIVILEGES
    FOR ROLE gigzlk_vector_admin
    IN SCHEMA ml
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
    TO gigzlk_vector_app;

COMMIT;