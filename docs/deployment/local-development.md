# Local PostgreSQL Development

## Scope

This setup runs PostgreSQL for local GigZLK development.
Redis is also available; see the Redis section below. Kafka and application containers are not included yet.

Requirements:
- Docker Desktop running Linux containers
- Docker Compose
- PowerShell 5.1 or later

Run the commands below from the repository root.

## First-time setup

Generate local credentials:

```powershell
.\infrastructure\docker\setup-local.ps1
```

The script creates infrastructure/docker/.env from .env.example.
It generates separate passwords and refuses to overwrite an existing file.
Never commit or share your .env.

Validate configuration without printing resolved passwords:

```powershell
docker compose --env-file infrastructure/docker/.env -f infrastructure/docker/compose.yaml config --quiet
```

Start PostgreSQL:

```powershell
docker compose --env-file infrastructure/docker/.env -f infrastructure/docker/compose.yaml up -d --wait postgres
```

Check status:

```powershell
docker compose --env-file infrastructure/docker/.env -f infrastructure/docker/compose.yaml ps
```

## Connections

From applications running directly on Windows:
- Host: 127.0.0.1
- Port: 5433 by default

From application containers on this Compose network:
- Host: postgres
- Port: 5432

A separate Compose project must explicitly join the network before
it can resolve postgres.

If host port 5433 is occupied, change POSTGRES_HOST_PORT in your
local .env, then recreate the service with the start command.

## Service databases

Each service has its own database and login role.

| Service | Database and role | Local password variable |
|---|---|---|
| Auth | gigzlk_auth | AUTH_DB_PASSWORD |
| User | gigzlk_user | USER_DB_PASSWORD |
| Job | gigzlk_job | JOB_DB_PASSWORD |
| Application | gigzlk_application | APPLICATION_DB_PASSWORD |
| Contract | gigzlk_contract | CONTRACT_DB_PASSWORD |
| Payment | gigzlk_payment | PAYMENT_DB_PASSWORD |
| Operations | gigzlk_operations | OPERATIONS_DB_PASSWORD |
| Chat | gigzlk_chat | CHAT_DB_PASSWORD |
| Notification | gigzlk_notification | NOTIFICATION_DB_PASSWORD |
| ML | gigzlk_ml | ML_DB_PASSWORD |

Use the relevant password from your own local .env.
Do not use gigzlk_admin as an application account.

The admin account remains privileged and can access all databases.
Service accounts have no default access to other service databases.

Service owners manage their own tables and migrations.
Prisma development migrations may need a separately provisioned
shadow database; service accounts intentionally lack CREATEDB.

## Data persistence

Database files are stored in the named volume:
gigzlk-local_postgres_data

Stop containers while retaining data:

```powershell
docker compose --env-file infrastructure/docker/.env -f infrastructure/docker/compose.yaml stop
```

Start them again using up -d --wait postgres.

Remove containers and the Compose network while retaining data:

```powershell
docker compose --env-file infrastructure/docker/.env -f infrastructure/docker/compose.yaml down
```

Do not add --volumes or -v unless intentionally deleting local data.

Initialization scripts run only when the data directory is empty.
Editing .env does not change passwords already stored in PostgreSQL.
Credential rotation requires updating the database role and local
configuration together.

A Docker volume is persistent storage, not a backup.

## Troubleshooting

Docker API named-pipe error:
Open Docker Desktop and wait for the engine to run.

Missing .env:
Check your working directory and run first-time setup if needed.

Inspect startup logs:

```powershell
docker compose --env-file infrastructure/docker/.env -f infrastructure/docker/compose.yaml logs --tail 100 postgres
```

A healthy container confirms server readiness, not every permission.

Verified during initial development:
- Auth authenticated to gigzlk_auth over TCP.
- Auth was denied CONNECT to gigzlk_payment.

Other service combinations have not yet been individually tested.

## Security scope

This is a local development configuration, not a production deployment.
The published database port binds to 127.0.0.1.
Passwords in container environment variables are accessible to Docker
administrators. Keep Docker access and local configuration restricted.

Do not paste .env contents or resolved Compose configuration into
issues, chat messages or logs.

## Redis

Redis holds temporary data such as caches, typing indicators and
rate-limit counters. PostgreSQL remains the durable source of truth.

Fresh setups:
setup-local.ps1 now generates REDIS_PASSWORD as well as database passwords.

Existing setups:
preserve your .env and database passwords. Add REDIS_HOST_PORT=6379
and a locally generated REDIS_PASSWORD before starting Redis.
Do not delete or regenerate working database credentials.

Start Redis from the repository root:

```powershell
docker compose --env-file infrastructure/docker/.env -f infrastructure/docker/compose.yaml up -d --wait redis
```

Connection settings:
- Windows applications: 127.0.0.1:6379
- Containers on the Compose network: redis:6379
- Password: REDIS_PASSWORD from your local .env

The current local setup uses one shared Redis password.
Key prefixes organize data; they do not enforce service isolation.
Service-specific ACLs are not configured yet.

Use service-specific keys, for example:
gigzlk:job:details:123
gigzlk:chat:typing:456

Define TTLs and cache invalidation rules in each owning service.
Do not put secrets or personal details in key names.

Persistence is disabled. Redis data is lost when its process restarts.
The dataset memory limit is 128 MB; total process memory can be higher.
The noeviction policy rejects memory-growing writes at the limit
rather than automatically evicting keys.

Services must handle Redis outages and write failures explicitly.
Security controls must not silently allow requests when Redis fails.
Financial balances and durable idempotency remain in PostgreSQL.

Validation completed:
- Authenticated PING returned PONG.
- Unauthenticated PING returned NOAUTH.
- A test value was readable before expiry.
- EXISTS returned 0 after its five-second TTL expired.

The Compose health check authenticates before checking PING.
Passwords in environment variables and startup arguments are visible
to Docker administrators. This is a local development configuration.
