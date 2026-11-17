# Log output

Run commands from the repository root. Complete the
[GKE prerequisites](../README.md#select-the-gke-cluster) and deploy
[Ping-pong and its database](../ping_pong/README.md) first.

## 1. Publish the image

```sh
gh workflow run publish-image.yaml --ref main -f image=log-output -f tag=3.4
gh run list --workflow publish-image.yaml --limit 5
```

Build and publish `ghcr.io/ehye/log-output:3.4`, then check the run status.
Wait for success. Make the package public or configure image-pull credentials.

## 2. Preview and deploy

If migrating from the older Ingress deployment, remove that Ingress **before**
applying the Gateway configuration:

```sh
kubectl -n exercises delete ingress log-output-ingress \
  --ignore-not-found --wait=true --timeout=600s
```

This removes the old public entry point and causes migration downtime. The
Gateway uses a different IP. Skip this step when already using Gateway.

```sh
kubectl kustomize log_output/
kubectl apply --dry-run=server -k log_output/
kubectl apply -k log_output/
kubectl -n exercises rollout status deployment/log-output-dep --timeout=300s
kubectl -n exercises wait --for=condition=Programmed gateway/log-output-gateway --timeout=600s
```

Preview and validate the configuration, apply Log output and the shared Gateway,
then wait for readiness. These commands do not deploy Ping-pong or PostgreSQL.

## 3. Verify both routes

```sh
GATEWAY_URL="http://$(kubectl -n exercises get gateway log-output-gateway \
  -o jsonpath='{.status.addresses[0].value}')"
curl -f "$GATEWAY_URL/"
curl -f "$GATEWAY_URL/pingpong"
curl -f "$GATEWAY_URL/"
```

Read the Gateway address, check Log output, increment the Ping-pong counter,
then check that Log output shows the increased total. Allow several minutes
for initial load-balancer health checks.

## Apply configuration changes

```sh
kubectl apply -k log_output/
kubectl -n exercises rollout restart deployment/log-output-dep
kubectl -n exercises rollout status deployment/log-output-dep --timeout=300s
```

Apply edited configuration and restart the Pods so updated environment variables
take effect.

## Troubleshooting

```sh
kubectl -n exercises get pods,gateway
kubectl -n exercises logs deployment/log-output-dep -c reader --tail=50
kubectl -n exercises logs deployment/log-output-dep -c writer --tail=50
kubectl -n exercises describe httproute log-output-route
kubectl -n exercises describe healthcheckpolicy
```

Check readiness, inspect each container's logs, and verify route/health-policy
status. Use the Ping-pong guide to check its database and internal Service.
