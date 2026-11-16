# Log output

Log output gets the ping-pong count through HTTP, not through a shared file.
Its two containers still share the latest log line through a Pod-local `emptyDir`:

- **writer:** generates a startup UUID and replaces `/shared/log.txt` immediately
  and every five seconds. It writes a temporary file and renames it atomically.
- **reader:** reads that file and calls Ping-pong's `GET /pings` on each HTTP request,
  returning the latest log line followed by `Ping / Pongs: <total>`.
  The volume is mounted read-only in this container.

Only the latest line is stored, not a growing history. Restarting the writer
generates a new UUID; restarting the reader does not change the file. The shared
log file survives container restarts but is lost when the Pod is replaced.
Ping-pong stores its count in PostgreSQL, so restarting Ping-pong preserves it.

### Run

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start:writer
```

In a second terminal, from the same directory:

```sh
pnpm start
```

Both processes default to `./data/log.txt`. Set `LOG_FILE` to the same path for
both processes to override it. Use `pnpm dev:writer` and `pnpm dev` for watch mode.
Start Ping-pong locally on port `3001`, as described in its README. The reader
defaults to `PING_PONG_URL=http://127.0.0.1:3001/pings`; override this variable
when Ping-pong uses a different address.

Open `http://localhost:3000/` to see the latest logged timestamp and startup UUID.
The timestamp updates with the five-second logging interval, not on each request.
Set `PORT` to override the default listening port of `3000`.
Before the writer creates the file, the reader returns `503` with `Retry-After: 1`.
Other file-read failures return `500`. The reader never creates or modifies the file.
An unavailable Ping-pong, invalid count, or request exceeding three seconds
returns `503` instead of an incorrect count. Reading Log output does not
increment the ping-pong count.

Run tests with `pnpm test`.

Example output:

```text
file content: this text is from file
env variable: MESSAGE=hello world
2020-03-30T12:15:17.705Z: 8523ecb1-c716-4cb6-a044-b9e83bb98e43.
Ping / Pongs: 3
```

### ConfigMap

`manifests/configmap.yaml` defines `information.txt` and `MESSAGE`. The reader
mounts only the file at `/etc/config/information.txt` (read-only) and receives
`MESSAGE` through `configMapKeyRef`. `INFORMATION_FILE` tells the reader where
to read the mounted file. These values appear before the existing HTTP output.

For local testing, create a file and start the reader with:

```sh
echo 'this text is from file' > information.txt
INFORMATION_FILE=./information.txt MESSAGE='hello world' pnpm start
```

When these variables are unset, the reader keeps its original output. A configured
but unreadable file returns `500`. File content is read on each request; ConfigMap
volume updates propagate eventually. Environment changes require a Pod restart.
Apply the ConfigMap and Deployment in the same namespace, for example:

```sh
kubectl -n exercises apply -f manifests/
kubectl -n exercises rollout restart deployment/log-output-dep
```

Rebuild and import the Log output image before restarting to run the updated code.

### Docker 

Build the image

```sh
docker build -t log-output:2.5 .
```

Both containers use this image. The Deployment runs `node dist/writer.js` in the
writer and `node dist/index.js` in the reader. The image's default command starts
only the reader, so running it alone requires a file supplied by a writer.

### GKE deployment

`kustomization.yaml` groups Log output's ConfigMap, Deployment, Service,
HealthCheckPolicy, and the shared Gateway and HTTPRoute. From the repository root:

```sh
kubectl kustomize log_output/
kubectl --context=gke_dwk-gke-514607_us-west2-b_dwk-cluster apply -k log_output/
kubectl -n exercises rollout status deployment/log-output-dep --timeout=300s
```

This requires the `exercises` namespace, Gateway API, and the existing Ping-pong
Service and database. It does not deploy Ping-pong or modify PostgreSQL storage.

Follow the [Ping-pong deployment guide](../ping_pong/README.md) to build and
deploy both applications and PostgreSQL. Only PostgreSQL needs a PVC; neither
Log output container mounts database storage. The manifests target GKE and use
`ghcr.io/ehye/log-output:3.4` for both containers. Publish it using the manual
GitHub Actions workflow before deploying. For a local build only, from `log_output/`:

```sh
docker build -t ghcr.io/ehye/log-output:3.4 .
```

In Kubernetes, `PING_PONG_URL` points to `http://ping-pong-svc:2345/pings`.
Kubernetes resolves the Service name inside the namespace; this request does
not go through Gateway. Only the reader listens on port `3000` and has an HTTP
readiness probe on `/`. Todo still uses the existing PVC for its image
cache: do not delete the PV/PVC or its files.

Log output shares a GKE Gateway with Ping-pong: `/` goes to Log output and
`/pingpong` is rewritten to `/` before forwarding to Ping-pong. Follow the
[Ping-pong deployment guide](../ping_pong/README.md#deploy-to-gke-when-ready)
for Gateway API enablement and the ordered migration steps. Remove the old
Ingress before attaching its Services to Gateway; this migration has downtime.
The old local Traefik entrypoint and host-port mapping do not apply on GKE.

Traffic flows through Gateway and HTTPRoute `/` to `log-output-svc:2345`, then
to the app on port `3000`. Both backend Services use ClusterIP. The Gateway and
route are in `manifests/gateway.yaml` and `manifests/route.yaml`. Each application's
`manifests/healthcheckpolicy.yaml` checks Pod port 3000 explicitly (`/` for Log
output, `/healthz` for Ping-pong) because
GKE Gateway does not infer health checks from readiness probes.

The writer also logs each successfully published line to stdout. Each writer
process (and therefore each Pod replica) generates its own UUID.

## PostgreSQL for the Ping-pong counter

`manifests/postgres.yaml` defines PostgreSQL 18 as a one-replica StatefulSet
named `ping-pong-postgres` in `exercises`, plus its ConfigMap and headless
Service. Its separate 1 GiB PVC uses the cluster's default StorageClass. The volume
is mounted at `/var/lib/postgresql`, matching PostgreSQL 18's data layout.

Ping-pong connects to this database; Log output still calls Ping-pong's `/pings`
over HTTP. See [Ping-pong deployment instructions](../ping_pong/README.md).
Todo uses its own separate PostgreSQL database in the `project` namespace.
