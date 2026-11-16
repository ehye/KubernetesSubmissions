# Ping-pong

A TypeScript HTTP application with a PostgreSQL-backed counter:

- `GET /pingpong` returns `pong 0`, then `pong 1`, and so on, incrementing the total.
- `GET /pings` returns the current total (initially `0`) without incrementing it.
- `GET /` checks database access and returns `200 OK` without incrementing the
  counter. Readiness probes and GKE load-balancer health checks use this path.
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

## Prepare images for GKE

Use **Actions → Build and publish image → Run workflow** to publish both
`ping-pong:3.2` and `log-output:3.2` to GHCR. Select the branch containing these
changes so the Ping-pong image includes the new `/` health endpoint. Make both
packages public, or configure pull credentials for private packages.

To build locally without pushing or deploying:

```sh
docker build -t ghcr.io/ehye/ping-pong:3.2 ./ping_pong
docker build -t ghcr.io/ehye/log-output:3.2 ./log_output
```

## Deploy to GKE when ready

Run from the repository root, after the images have been published. Verify the
kubectl context before making changes. GKE's HTTP load balancing add-on must be
enabled (normally the default). These commands provision billable cloud resources.

```sh
gcloud container clusters get-credentials CLUSTER_NAME \
  --location=REGION_OR_ZONE --project=PROJECT_ID
kubectl config current-context
kubectl create namespace exercises --dry-run=client -o yaml | kubectl apply -f -

# Create once; do not regenerate the password for an existing database.
kubectl -n exercises create secret generic ping-pong-postgres-secret \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 24)"

# Keep the existing Secret if the database already exists.
kubectl -n exercises apply -f log_output/manifests/postgres.yaml
kubectl -n exercises rollout status statefulset/ping-pong-postgres --timeout=300s
kubectl -n exercises apply -f ping_pong/manifests/
kubectl -n exercises apply -f log_output/manifests/configmap.yaml
kubectl -n exercises apply -f log_output/manifests/service.yaml
kubectl -n exercises apply -f log_output/manifests/deployment.yaml
kubectl -n exercises rollout status deployment/ping-pong-dep --timeout=300s
kubectl -n exercises rollout status deployment/log-output-dep --timeout=300s

# Create Ingress only after the Pods and their readiness probes exist.
kubectl -n exercises apply -f log_output/manifests/ingress.yaml
kubectl -n exercises get ingress log-output-ingress --watch
```

PostgreSQL uses its own PVC,
`postgres-data-ping-pong-postgres-0`; do not reuse Todo's image-cache volume.
The image `postgres:18` is pulled from Docker Hub.
Database name and user come from `ping-pong-postgres-config`; the password comes
from `ping-pong-postgres-secret`. All database connection settings reach Ping-pong
as environment variables.

The PVC survives StatefulSet deletion, but deleting the PVC can delete its data
depending on the PV reclaim policy. New claims use the cluster's default storage
class, not the k3d-specific `local-path` setting. Changing initialization environment variables does not change an
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

### Shared GKE Ingress

The two applications share `log_output/manifests/ingress.yaml`, using the
`kubernetes.io/ingress.class: gce` annotation (not Traefik). Both Services use
`NodePort` for the GKE external Ingress; neither needs its own `LoadBalancer`.
Existing direct access at the old LoadBalancer Service IP stops when switching
the Service to NodePort. The Ingress provides a different external IP, on port 80.

| Browser URL | Application |
| --- | --- |
| `http://INGRESS_IP/pingpong` | Ping-pong (exact path) |
| `http://INGRESS_IP/` | Log output (prefix fallback) |

No URL rewrite is used. Requests to `/pings` through Ingress fall back to Log
output, not Ping-pong; Log output accesses `/pings` through the internal Service.
Google checks each backend's `/` directly, independently of the Ingress path
rules. Both HTTP readiness probes use `/` on container port 3000. Log output's
probe calls `/pings`, which reads the count but never increments it. No liveness
probe tied to database availability is added.

Load-balancer provisioning can take several minutes after Pods are Ready.
For an already existing Ingress, changing a readiness probe alone does not
necessarily update its cloud health check; inspect the backend health checks
if it remains unhealthy. Do not apply `cluster/traefik-config.yaml` to GKE.

After the Ingress address appears:

```sh
INGRESS_IP=$(kubectl -n exercises get ingress log-output-ingress \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
curl -f "http://${INGRESS_IP}/"
curl -f "http://${INGRESS_IP}/pingpong"
curl -f "http://${INGRESS_IP}/"
```

The final Log output response should show the increased Ping-pong total.
Repeated root/health requests must not increase it. For diagnosis, use
`kubectl -n exercises describe ingress log-output-ingress` and inspect Pod logs.

These manifests now target GKE. For the earlier k3d/Traefik setup, use the older
release manifests or separate local overrides; the GKE Ingress will not be
handled by k3d's default Traefik controller. Todo is not changed by this setup.
