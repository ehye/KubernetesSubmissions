# Ping-pong

Run commands from the repository root.

## GKE deployment

Complete the [GKE prerequisites](../todo_app/README.md#select-the-gke-cluster). If you need to publish the image, run:

```sh
gh workflow run publish-image.yaml --ref main -f image=ping-pong -f tag=3.4
```

Create the namespace and check for the database password:

```sh
kubectl create namespace exercises --dry-run=client -o yaml | kubectl apply -f -
kubectl -n exercises get secret ping-pong-postgres-secret
```

**New database only:** if the Secret is missing, create it. For an existing database, reuse its password and PVC to preserve the counter.

```sh
kubectl -n exercises create secret generic ping-pong-postgres-secret \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 24)"
```

```sh
kubectl -n exercises apply -f log_output/manifests/postgres.yaml
kubectl -n exercises rollout status statefulset/ping-pong-postgres --timeout=300s
kubectl -n exercises apply -f ping_pong/manifests/
kubectl -n exercises rollout status deployment/ping-pong-dep --timeout=300s
kubectl -n exercises port-forward svc/ping-pong-svc 3001:2345
```

At `http://localhost:3001`, `/healthz` checks database health, `/pings` reads the counter, and `/` increments it. For public access at `/pingpong`, see the [shared Gateway guide](../log_output/README.md).

## Local k3d: CPU-gated canary

Requires Ping-pong in `exercises`, Argo Rollouts, and Prometheus scraping container CPU in `monitoring`.

```sh
kubectl --context=k3d-k3d-test apply -f ping_pong/local/
kubectl --context=k3d-k3d-test -n exercises get rollout ping-pong --watch
```

The first revision becomes stable. For updates, change the Pod template on `ping-pong-dep` and leave that Deployment scaled to zero: Argo manages the Pods. One stable Pod and one canary share traffic while [`cpu-usage-rate`](local/cpu-analysis.yaml) checks total CPU across `exercises` every 30 seconds for five minutes. Any reading above `0.1` cores (100m) aborts promotion; missing data cannot pass.

**Test rejection:** set the threshold to `0`, reapply the template, and change a Pod-template annotation. Check the failed run with `kubectl --context=k3d-k3d-test -n exercises get analysisrun`. Restore `0.1`, reapply, and undo the test annotation.
