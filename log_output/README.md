# Log output on local k3d

Run from the repository root. The `exercises` namespace needs Ping-pong and its
database, and the cluster needs Envoy Gateway with the `local-envoy` GatewayClass
(see [`cluster/k3d-envoy.yaml`](../cluster/k3d-envoy.yaml)).

```sh
docker build -t log-output:3.4 log_output
k3d image import log-output:3.4 -c k3d-test
kubectl --context=k3d-k3d-test apply -k log_output/
kubectl --context=k3d-k3d-test -n exercises rollout status deployment/log-output-dep
```

Both containers use the imported image. For Argo CD, sync the `log_output`
Kustomize path after the manifests are pushed to the tracked revision.

With k3d host port `8082` mapped to listener port `30080`, open
<http://localhost:8082/> for Log output. `/pingpong` routes to Ping-pong and
increments its counter.
