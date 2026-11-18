# Gateway boundary test foundation

Owner: Member 4.

This is an isolated NGINX gateway test environment with a mock Auth upstream.
It is not connected to the shared Auth database, real Auth or either BFF.

## Prerequisites

- Docker Desktop running Linux containers.
- Repository root as the PowerShell working directory.
- Available loopback ports 18080 and 18443.
- For the certificate-generation command below, the existing
  gigzlk-auth-migrate:dev image containing Node.js and OpenSSL.

## Development certificates

Create the ignored output directory:

```powershell
New-Item -ItemType Directory -Force .\infrastructure\gateway\.local | Out-Null
```

Generate certificates:

```powershell
$gatewayCertDirectory = (Resolve-Path .\infrastructure\gateway\.local).Path
$gatewayCertScript = (Resolve-Path .\infrastructure\gateway\generate-dev-certs.cjs).Path

docker run --rm `
    --network none `
    --mount "type=bind,source=$gatewayCertDirectory,target=/certs" `
    --mount "type=bind,source=$gatewayCertScript,target=/scripts/generate-dev-certs.cjs,readonly" `
    --entrypoint node `
    gigzlk-auth-migrate:dev `
    /scripts/generate-dev-certs.cjs
```

The generator refuses to overwrite a non-empty directory.
Certificates last 30 days and cover gateway, localhost and 127.0.0.1.

Never commit generated certificates or private keys.
NGINX receives only the gateway certificate and private key.
Test clients receive only ca.crt; the CA private key is not mounted.

For renewal, stop this test environment, securely archive or remove only its
generated development certificate files, generate again, and recreate the
gateway container so it loads the new files. Do not delete database volumes.

CI runs the generator with Node.js and OpenSSL on the runner, using an
explicit output-directory argument. It does not require the Auth image.

## Start and validate

```powershell
docker compose -f infrastructure/gateway/compose.test.yaml config --quiet
```

Continue only after successful validation:

```powershell
docker compose -f infrastructure/gateway/compose.test.yaml up -d --wait
docker compose -f infrastructure/gateway/compose.test.yaml exec -T gateway nginx -t
```

Windows host mappings:
- Public HTTP: localhost:18080 -> container port 8080.
- Private HTTPS: localhost:18443 -> container port 8443.

The public listener currently rejects all routes.
The private listener permits six exact Auth-operation POST paths.
The upstream is always the mock service in this test configuration.

## Run boundary tests

```powershell
$gatewayTestScript = (Resolve-Path .\infrastructure\gateway\gateway.test.cjs).Path
$gatewayPublicCA = (Resolve-Path .\infrastructure\gateway\.local\ca.crt).Path

docker run --rm `
    --network gigzlk-gateway-test_backend `
    --mount "type=bind,source=$gatewayTestScript,target=/tests/gateway.test.cjs,readonly" `
    --mount "type=bind,source=$gatewayPublicCA,target=/certs/ca.crt,readonly" `
    node:24-bookworm-slim `
    node --test /tests/gateway.test.cjs
```

Use only synthetic assertions and test data.

Verified locally:
- Six exact private POST paths reach the mock unchanged.
- Public Auth paths never reach the mock.
- Path aliases, query strings and non-POST methods are rejected.
- Missing and oversized assertion headers are rejected.
- A 4096-byte synthetic assertion passes the gateway size check.
- Browser cookies and caller identity headers are stripped.
- Mock Set-Cookie is removed and Cache-Control becomes no-store.
- Untrusted certificates and incorrect TLS hostnames are rejected.
- Rejected-request groups do not increment the mock operation counter.

The gateway does not cryptographically validate JWTs.
Real Auth validation, replay protection and operation authorization require
separate integration tests.

Expired-certificate behavior, upstream failures, request-body forwarding,
BFF redirect handling and production logging controls are not yet verified
by this suite. Images currently use mutable tags.

## Stop

```powershell
docker compose -f infrastructure/gateway/compose.test.yaml down --remove-orphans
```

This command targets only the gigzlk-gateway-test project.

## CI

.github/workflows/gateway.yml generates temporary certificates and runs
the isolated checks for relevant pull requests and main-branch pushes.

Live authentication integration remains disconnected.