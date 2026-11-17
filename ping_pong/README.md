# Ping-pong

Run commands from the repository root. Complete the
[GKE prerequisites](../todo_app/README.md#select-the-gke-cluster) first.

## 1. Publish the image

```sh
gh workflow run publish-image.yaml --ref main -f image=ping-pong -f tag=3.4
gh run list --workflow publish-image.yaml --limit 5
```

Build and publish `ghcr.io/ehye/ping-pong:3.4`, then check the run status.
Wait for success. Make the package public or configure image-pull credentials.

## 2. Prepare the namespace and password

```sh
kubectl create namespace exercises --dry-run=client -o yaml | kubectl apply -f -
kubectl -n exercises get secret ping-pong-postgres-secret
```

Create the namespace if needed and check for the database password.
**Only if the Secret is missing on a first deployment**, run:

```sh
kubectl -n exercises create secret generic ping-pong-postgres-secret \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 24)"
```

Store a random password for the new database. Keep the existing Secret on
subsequent deployments; do not regenerate it for an existing database.

## 3. Deploy the database and application

```sh
kubectl -n exercises apply -f log_output/manifests/postgres.yaml
kubectl -n exercises rollout status statefulset/ping-pong-postgres --timeout=300s
kubectl -n exercises apply -f ping_pong/manifests/
kubectl -n exercises rollout status deployment/ping-pong-dep --timeout=300s
```

Start PostgreSQL and wait for it, then deploy Ping-pong and wait for readiness.
Retain `postgres-data-ping-pong-postgres-0` to preserve the counter.

For public access, follow the [Log output deployment guide](../log_output/README.md)
to publish its image and deploy the shared Gateway.

## 4. Check internal access

```sh
kubectl -n exercises port-forward service/ping-pong-svc 3001:2345
```

Forward local port `3001` to Ping-pong. Keep this terminal running and use another:

```sh
curl -f http://127.0.0.1:3001/healthz
curl -f http://127.0.0.1:3001/pings
curl -f http://127.0.0.1:3001/
curl -f http://127.0.0.1:3001/pings
```

Check database health, read the current counter, increment it, and confirm the
new total. `/healthz` and `/pings` do not increment. Public requests use
`/pingpong` on the Gateway instead of `/`. Stop port-forwarding with Ctrl+C.

## Check persistence and logs

```sh
kubectl -n exercises rollout restart deployment/ping-pong-dep
kubectl -n exercises rollout status deployment/ping-pong-dep --timeout=300s
kubectl -n exercises exec ping-pong-postgres-0 -- \
  psql -U pingpong -d pingpong -c 'SELECT * FROM ping_counter;'
kubectl -n exercises logs deployment/ping-pong-dep --tail=50
kubectl -n exercises get pods,pvc
```

Restart Ping-pong, inspect the saved counter directly, and check logs/storage.
Do not delete the database PVC. If port-forwarding was active, restart it after
the Pod is replaced.
