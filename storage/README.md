# Persistent storage

Todo uses `shared-data-pvc` in the `default` namespace for its image cache at
`/shared/todo-image/image.jpg`. See [Todo](../todo_app/README.md) for details.

Log output and Ping-pong no longer mount this PVC. They communicate over HTTP:
Log output calls Ping-pong's `/pings` endpoint. Do not delete the PV/PVC, since
Todo still needs it. Old log/counter files may remain on the volume, but neither
application reads or updates them now.

## Local k3d storage design

- The PV stores files in `/tmp/kube` on `k3d-k3d-test-server-0`.
- The PV and PVC use `storageClassName: manual`.
- Node affinity schedules Todo on the node holding the local volume.
- Prepare the directory for UID/GID `1000` before mounting it.
- Files survive Pod replacement, but deleting the node or cleaning `/tmp` can
  remove them.

## Prepare storage

For a new setup, run from the repository root:

```sh
docker exec --user 0 k3d-k3d-test-server-0 mkdir -p /tmp/kube
docker exec --user 0 k3d-k3d-test-server-0 chown 1000:1000 /tmp/kube
docker exec --user 0 k3d-k3d-test-server-0 chmod 2770 /tmp/kube

kubectl apply -f storage/
kubectl -n default wait --for=jsonpath='{.status.phase}'=Bound pvc/shared-data-pvc --timeout=60s
```

Check `kubectl get nodes` and update the PV node affinity before first deployment
if your node name differs. Todo and the PVC must be in the same namespace.
Existing data is not deleted by these directory-preparation commands.
