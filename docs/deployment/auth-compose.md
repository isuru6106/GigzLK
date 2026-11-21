# Local Auth with Docker Compose

Run all PowerShell commands from the repository root.

This setup runs Auth with its service-owned PostgreSQL database.
It does not enable gateway routing, BFF integration, login or sessions.

## Prerequisites

- Docker Desktop running Linux containers.
- Existing infrastructure/docker/.env configured with local passwords.
- Python ML development environment installed from its locked requirements,
  including python-dotenv, for the secret-generation command below.

PostgreSQL initialization creates the gigzlk_auth database and role.
Initialization scripts run only when PostgreSQL initializes an empty data
directory. Changing .env does not change passwords in an existing database.

## Create the local database secret

The connection URL uses postgres:5432 inside Docker.
The password is URL-encoded before constructing the connection string.

```powershell
@'
from pathlib import Path
from urllib.parse import quote
from dotenv import dotenv_values

folder = Path("infrastructure/docker")
values = dotenv_values(folder / ".env", interpolate=False)
password = values.get("AUTH_DB_PASSWORD")

if not password:
    raise SystemExit("AUTH_DB_PASSWORD is missing or empty.")

url = (
    "postgresql://gigzlk_auth:"
    + quote(password, safe="")
    + "@postgres:5432/gigzlk_auth"
)

(folder / ".env.auth-database-url").write_text(url, encoding="utf-8")
print("Local Auth database secret file created.")
'@ | .\ml-service\.venv\Scripts\python.exe -

git check-ignore .\infrastructure\docker\.env.auth-database-url
```

Confirm the secret path is ignored before continuing.
Never commit or print the secret file.

Compose mounts the file only into Auth and the migration task.
The startup command reads it into DATABASE_URL for the child process.
This is local file-based secret delivery, not an encrypted secrets vault.
Protect the host file and access to Docker.

## Configure and build

```powershell
$authComposeArgs = @(
    "--env-file", "infrastructure/docker/.env",
    "-f", "infrastructure/docker/compose.yaml",
    "-f", "infrastructure/docker/compose.auth.yaml"
)

docker compose @authComposeArgs --profile auth --profile auth-tools config --quiet
```

Continue only if validation succeeds.

```powershell
docker compose @authComposeArgs --profile auth --profile auth-tools build auth auth-migrate
```

The migration image uses the build stage, including Prisma CLI and OpenSSL.
The application image uses the non-root production runtime stage.

## Start PostgreSQL and apply migrations

```powershell
docker compose @authComposeArgs up -d --wait postgres
```

After PostgreSQL is healthy:

```powershell
docker compose @authComposeArgs --profile auth-tools run --rm auth-migrate
```

Continue only if migrations succeed.
This controlled task applies tracked migrations; Auth startup does not run them.
Repeated execution should report no pending migrations.

## Start Auth

```powershell
docker compose @authComposeArgs --profile auth up -d --wait auth
docker compose @authComposeArgs --profile auth ps auth
```

Auth joins the internal auth_private network.
PostgreSQL joins both its existing default network and auth_private.

Auth has no published host port.
A display of 3006/tcp alone is container metadata, not a host mapping.
Host browsers cannot access this Auth service directly.

## Check health

```powershell
@'
(async () => {
  for (const path of ["/health/live", "/health/ready"]) {
    const response = await fetch(
      "http://127.0.0.1:3006" + path,
      { signal: AbortSignal.timeout(5000) }
    );
    console.log(path, response.status, await response.text());
    if (!response.ok) process.exitCode = 1;
  }
})().catch(() => {
  console.error("Health check failed");
  process.exitCode = 1;
});
'@ | docker compose @authComposeArgs --profile auth exec -T auth node
```

Expected: HTTP 200 and {"status":"UP","service":"auth"} for both endpoints.

Liveness checks the application.
Readiness checks database access and Account table availability.
Readiness does not verify the complete migration history.

## Troubleshooting and stopping

If Auth is live but not ready, check migration completion and database
credentials. Regenerating the secret does not rotate a stored database password.

Do not delete PostgreSQL volumes to resolve a credential or migration error.

The authComposeArgs variable must be defined again in a new PowerShell session.
Use the same two Compose files for Auth lifecycle commands.

Stop Auth without stopping shared infrastructure:

```powershell
docker compose @authComposeArgs --profile auth stop auth
```

Do not use down --volumes unless deliberately deleting local database data.

## Verification recorded

- Runtime and migration images built successfully.
- Prisma generation and migration ran without OpenSSL detection warnings.
- Both existing migrations applied successfully.
- A subsequent migration run reported no pending migrations.
- Auth liveness and readiness returned HTTP 200.
- Compose reported PostgreSQL and Auth healthy.

Gateway routing, TLS and BFF service authentication are separate work.