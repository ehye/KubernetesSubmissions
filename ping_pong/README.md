# Ping-pong

A self-contained TypeScript HTTP application with an in-memory counter:

- `GET /pingpong` returns `pong 0`, then `pong 1`, and so on, incrementing the total.
- `GET /pings` returns the current total (initially `0`) without incrementing it.
- After three requests to `/pingpong`, `/pings` returns `3`.
- Restarting the process resets the counter. No volume or counter file is used.

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
Run tests with `pnpm test`.

## Deploy to the existing k3d cluster

```sh
docker build -t ping-pong:2.1 ./ping_pong
docker build -t log-output:2.1 ./log_output
k3d image import ping-pong:2.1 log-output:2.1 -c <cluster-name>
kubectl -n default apply -f ping_pong/manifests/
kubectl -n default apply -f log_output/manifests/
kubectl -n default rollout status deployment/ping-pong-dep
kubectl -n default rollout status deployment/log-output-dep
```

Run these commands from the repository root, with kubectl targeting the same
cluster used for the image import. Neither application needs a PVC now. Keep
the existing PV/PVC because Todo still uses it for its image cache. Keep one
Ping-pong replica; each process has its own counter.

Within the same namespace, Log output uses `http://ping-pong-svc:2345/pings`.
The existing Ingress exposes `/pingpong` but not the internal `/pings` endpoint.
To inspect `/pings` locally without changing Ingress:

```sh
kubectl -n default port-forward service/ping-pong-svc 3001:2345
```

Then open `http://127.0.0.1:3001/pings`.

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
