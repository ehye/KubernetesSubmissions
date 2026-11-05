# Ping-pong

A self-contained TypeScript HTTP application. Each `GET /pingpong` returns
`pong 0`, then `pong 1`, and so on.

## Deploy to the existing k3d cluster

```sh
docker build -t ping-pong:1.9 ./ping_pong
k3d image import ping-pong:1.9 -c <cluster-name>
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
