# Ping-pong

A TypeScript HTTP application with a PostgreSQL-backed counter:

- `GET /pingpong` returns `pong 0`, then `pong 1`, and so on, incrementing the total.
- `GET /pings` returns the current total (initially `0`) without incrementing it.
- After three requests to `/pingpong`, `/pings` returns `3`.
- Restarting Ping-pong or replacing the PostgreSQL Pod preserves the counter,
  as long as the database PVC is retained. No counter file is used.

Log output calls `/pings` over HTTP and displays the total with its timestamp
and UUID. The applications no longer share storage with each other.

## Local execution

From `ping_pong/`:

```sh
pnpm install --frozen-lockfile
pnpm build
PORT=3001 pnpm start
```

Open `http://127.0.0.1:3001/pingpong` to increment or `/pings` to read the total.
`PORT` defaults to `3000`; use `3001` when running beside Log output locally.
Before starting, supply `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD`
for a running PostgreSQL database. For example:

```sh
export PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=pingpong PGUSER=pingpong
read -rsp 'Database password: ' PGPASSWORD; echo
export PGPASSWORD
PORT=3001 pnpm start
```

Startup creates `ping_counter` and seeds its single row only if missing. Each
`/pingpong` executes one atomic `UPDATE ... RETURNING`; `/pings` only reads.
Database failures return `503`, never an incorrect zero. A database unavailable
at startup makes the process exit; Kubernetes retries it automatically.

Run unit tests with `pnpm test`. To include database integration tests, point the
same `PG*` variables at a **disposable test database** and run:

```sh
TEST_DATABASE=1 pnpm test
```

Integration tests reset the test counter, verify atomic increments, and check
that restarting the Ping-pong process preserves it. Never use the real database
for these tests.

## Deploy to the existing k3d cluster

```sh
docker build -t ping-pong:2.7 ./ping_pong
docker build -t log-output:2.5 ./log_output
k3d image import ping-pong:2.7 log-output:2.5 -c <cluster-name>

# Create once; do not regenerate the password for an existing database.
kubectl -n exercises create secret generic ping-pong-postgres-secret \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 24)"

kubectl -n exercises apply -f log_output/manifests/
kubectl -n exercises rollout status statefulset/ping-pong-postgres --timeout=120s
kubectl -n exercises apply -f ping_pong/manifests/
kubectl -n exercises rollout status deployment/ping-pong-dep
kubectl -n exercises rollout status deployment/log-output-dep
```

Run these commands from the repository root, with kubectl targeting the same
cluster used for the image import. PostgreSQL uses its own PVC,
`postgres-data-ping-pong-postgres-0`; do not reuse Todo's image-cache volume.
The image `postgres:18` can be pulled automatically or imported separately.
Database name and user come from `ping-pong-postgres-config`; the password comes
from `ping-pong-postgres-secret`. All database connection settings reach Ping-pong
as environment variables.

The PVC survives StatefulSet deletion, but deleting the PVC can delete its data
(`local-path` reclaim policy is `Delete`). Node/cluster deletion can also lose
local data. Changing initialization environment variables does not change an
existing database's username/password. No existing in-memory count is migrated.

Within the same namespace, Log output uses `http://ping-pong-svc:2345/pings`.
The existing Ingress exposes `/pingpong` but not the internal `/pings` endpoint.
To inspect `/pings` locally without changing Ingress:

```sh
kubectl -n exercises port-forward service/ping-pong-svc 3001:2345
```

Then open `http://127.0.0.1:3001/pings`.

To verify persistence, record `/pings`, then replace each Pod in turn and check
that the value is unchanged after recovery (stop any traffic to `/pingpong` first):

```sh
kubectl -n exercises rollout restart deployment/ping-pong-dep
kubectl -n exercises rollout status deployment/ping-pong-dep
kubectl -n exercises delete pod ping-pong-postgres-0
kubectl -n exercises rollout status statefulset/ping-pong-postgres --timeout=120s
```

Restart `port-forward` after replacing the Ping-pong Pod. For a direct SQL check:

```sh
kubectl -n exercises exec ping-pong-postgres-0 -- \
  psql -U pingpong -d pingpong -c 'SELECT * FROM ping_counter;'
```

### Configure the dedicated ingress listener

The Traefik HelmChartConfig adds a dedicated `log-output` entrypoint on container port `8001`, exposed through its LoadBalancer

```sh
kubectl apply -f cluster/traefik-config.yaml
```

The two applications share `log_output/manifests/ingress.yaml`.

| Browser URL | Application |
| --- | --- |
| `http://127.0.0.1:8082/pingpong` | Ping-pong |
| `http://127.0.0.1:8082/` | Log output |
| `http://127.0.0.1:8081/` | Todo (unchanged) |
