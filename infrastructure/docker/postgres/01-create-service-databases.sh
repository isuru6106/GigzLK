#!/usr/bin/env bash
(
set -euo pipefail

for service in auth user job application contract payment operations chat notification ml; do
    password_key="${service^^}_DB_PASSWORD"
    export SERVICE_DB_PASSWORD="${!password_key:?Missing service password}"
    export SERVICE_DB_NAME="gigzlk_${service}"

    psql --username "$POSTGRES_USER" --dbname postgres \
        --set=ON_ERROR_STOP=1 <<'SQL'
\getenv db_name SERVICE_DB_NAME
\getenv db_password SERVICE_DB_PASSWORD

SELECT format(
    'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
    :'db_name', :'db_password'
) \gexec

SELECT format(
    'CREATE DATABASE %I OWNER %I',
    :'db_name', :'db_name'
) \gexec

SELECT format(
    'REVOKE ALL ON DATABASE %I FROM PUBLIC',
    :'db_name'
) \gexec

SELECT format(
    'GRANT CONNECT ON DATABASE %I TO %I',
    :'db_name', :'db_name'
) \gexec
SQL

    unset SERVICE_DB_PASSWORD
    echo "Initialized database: ${SERVICE_DB_NAME}"
done

unset SERVICE_DB_NAME
)
