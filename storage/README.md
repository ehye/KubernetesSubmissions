# Shared persistent storage

Log output and Ping-pong mount the same PVC, `shared-data-pvc`, in the `default`
namespace. 

## Local k3d storage design

- The PV stores files in `/tmp/kube` on `k3d-k3d-test-server-0`.
- Both the PV and PVC use `storageClassName: manual`. Node affinity keeps both
  Pods on that node, where `ReadWriteOnce` lets them share the volume.
- Create the directory and give UID/GID `1000` access using the commands below.
- Keep one replica per application. `Recreate` prevents overlapping writers
  during deployment updates.
- Files survive Pod replacement, but deleting the node or cleaning `/tmp` can
  remove them.

## Deploy

From the repository root, with kubectl targeting the existing k3d cluster:

```sh
docker build -t log-output:1.11 ./log_output
docker build -t ping-pong:1.11 ./ping_pong
k3d image import log-output:1.11 ping-pong:1.11 -c <cluster-name>

docker exec --user 0 k3d-k3d-test-server-0 mkdir -p /tmp/kube
docker exec --user 0 k3d-k3d-test-server-0 chown 1000:1000 /tmp/kube
docker exec --user 0 k3d-k3d-test-server-0 chmod 2770 /tmp/kube

kubectl apply -f storage/
kubectl -n default wait --for=jsonpath='{.status.phase}'=Bound pvc/shared-data-pvc --timeout=60s
kubectl -n default apply -f ping_pong/manifests/
kubectl -n default apply -f log_output/manifests/
kubectl -n default rollout status deployment/ping-pong-dep
kubectl -n default rollout status deployment/randomstring-dep
```

Check `kubectl get nodes` and update the PV node affinity before first deployment
if your node name differs. Both Pods and the PVC must remain in the same namespace.
The existing shared Ingress, Traefik listener, and k3d port mappings are unchanged;
see [Ping-pong](../ping_pong/README.md) for listener configuration.

With that listener configured, visit `http://127.0.0.1:8082/pingpong` three times,
then visit `http://127.0.0.1:8082/`:

```text
2020-03-30T12:15:17.705Z: 8523ecb1-c716-4cb6-a044-b9e83bb98e43.
Ping / Pongs: 3
```

To verify persistence, restart the ping-pong Deployment (do not delete the PVC):

```sh
kubectl -n default rollout restart deployment/ping-pong-dep
kubectl -n default rollout status deployment/ping-pong-dep
```
