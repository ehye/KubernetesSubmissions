# Ping-pong

A self-contained TypeScript HTTP application. Each `GET /pingpong` returns
`pong 0`, then `pong 1`, and so on. The total is persisted atomically to
`/shared/pingpong-count.txt`, shared with Log output through one PVC. After three
requests, Log output shows `Ping / Pongs: 3`. Restarts preserve the counter.

For local execution, `COUNTER_FILE` defaults to `./data/pingpong-count.txt`.
Set it to the same file path used by the Log output reader when running the
applications outside Kubernetes. `PORT` defaults to `3000`.

## Deploy to the existing k3d cluster

```sh
docker build -t ping-pong:1.11 ./ping_pong
k3d image import ping-pong:1.11 -c <cluster-name>
```

Create the PV/PVC before applying the Deployments. Follow the
[shared storage deployment guide](../storage/README.md) to deploy both apps and
verify persistence. Keep a single replica; counter updates are not locked across
multiple application processes.

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
