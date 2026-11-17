# Persistent storage

Run commands from the repository root. **Never delete a PVC to fix a deployment
unless you intend to delete its saved data.**

## GKE: inspect existing storage

```sh
kubectl config current-context
kubectl get storageclass
kubectl -n project get pvc
kubectl -n exercises get pvc
```

Confirm the target cluster, list available storage classes, and check the Todo
and Ping-pong claims. Claims used by running workloads should be `Bound`.

```sh
kubectl -n project describe pvc shared-data-pvc
kubectl -n project describe pvc postgres-data-todo-postgres-0
kubectl -n exercises describe pvc postgres-data-ping-pong-postgres-0
```

Inspect provisioning events and the volumes attached to each claim. The GKE
deployment guides create these claims; do not apply the local PV manifests below
to GKE. See [Todo](../todo_app/README.md) and [Ping-pong](../ping_pong/README.md).

## Local k3d only: prepare image-cache storage

Select your local context first and verify the cluster/node names match your setup:

```sh
kubectl config use-context k3d-k3d-test
kubectl get nodes
```

Switch to the local cluster and list its nodes. Update the node affinity in
`storage/persistentvolume.yaml` if the node name differs.

```sh
docker exec --user 0 k3d-k3d-test-server-0 mkdir -p /tmp/kube
docker exec --user 0 k3d-k3d-test-server-0 chown 1000:1000 /tmp/kube
docker exec --user 0 k3d-k3d-test-server-0 chmod 2770 /tmp/kube
```

Create the node directory and grant the application user write access. These
commands do not erase its contents.

```sh
kubectl create namespace project --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f storage/persistentvolume.yaml -f storage/persistentvolumeclaim.yaml
kubectl -n project get pvc shared-data-pvc
```

Create the namespace, apply the local volume and claim, and check claim status.
If binding waits for a consumer, deploy Todo before waiting for `Bound`.
This local storage is not migrated automatically when deploying to GKE.
