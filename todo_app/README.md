# Todo app

Run all commands from the repository root.

## Local k3d GitOps

The [GitOps repository](https://github.com/ehye/KubernetesSubmissions-gitops) owns the live Todo Kustomize configuration and [Argo CD Applications](https://github.com/ehye/KubernetesSubmissions-gitops/tree/main/argocd). All three Applications track GitOps `main`. Apply the Application manifests from that repository after provisioning their namespace Secrets.

| Source event | GitOps path | Behavior |
|---|---|---|
| Todo change on `main` | `overlays/staging` | Changes under `todo_app/`, `todo_backend/`, `broadcaster/`, or to the promotion workflow/script build and record all three image digests. |
| Tag a Todo change | `overlays/production` | Promote the tagged commit’s recorded staging digests without rebuilding. Wait up to two minutes for a concurrent staging build to publish its record. |

Use the usual exercise tag (for example, `git tag 5.2 <staged-commit>` then `git push origin 5.2`). CI compares the tagged commit with its first parent: a Todo change requires a staging record for that exact commit; an unrelated change, such as DummySite in `5.1`, skips publication.

The [promotion workflow](../.github/workflows/todo-environments.yaml) uses the source repo's `GITHUB_TOKEN` for GHCR and a short-lived GitHub App token for the GitOps push. Configure the repository variable `GITOPS_APP_CLIENT_ID` and secret `GITOPS_APP_PRIVATE_KEY`; install the App on the GitOps repo with Contents write access. CI does not need cluster credentials. Configuration-only changes go directly to the GitOps repo.

Staging logs notifications and runs no database backups. Production uses Discord and scheduled backups. The existing `project` installation keeps its imported local images at <http://localhost:8081>.

The following sections describe the separate GKE setup.

## Select the GKE cluster

Install and authenticate `gcloud`, `kubectl`, and `gh`, then run:

```sh
gcloud container clusters get-credentials dwk-cluster \
  --zone=us-west2-b --project=dwk-gke-514607
kubectl config current-context
kubectl get gatewayclass gke-l7-global-external-managed
```

Load the cluster credentials, confirm kubectl targets GKE rather than k3d, and
check Gateway API availability. If Gateway API has not been enabled yet:

```sh
gcloud container clusters update dwk-cluster \
  --zone=us-west2-b --project=dwk-gke-514607 --gateway-api=standard
```

Enable Gateway API, then repeat the GatewayClass check after provisioning.
Deployment creates billable resources. Preserve existing database Secrets and PVCs.

## Deploy through Actions

```sh
gh workflow run main.yaml --ref main
gh run list --workflow main.yaml --limit 5
```

Build images in Artifact Registry and deploy to GKE. Pushes and merges to `main`
also trigger this workflow. Only `main` runs, using namespace `project` and its
existing database Secret.

If enabled later, other branches use their own namespace, credentials, PVCs, and
Gateway IP. DNS is not configured; `project` is reserved.

Deleting a branch triggers `delete-environment.yaml` once it is on `main`.
Cleanup removes only a matching, workflow-marked namespace, including its PVCs
and saved data. Production/system namespaces and recreated branches are skipped.
Artifact Registry images remain. Existing unmarked namespaces are not deleted.

## 1. Publish images

```sh
gh workflow run publish-image.yaml --ref main -f image=todo-app -f tag=3.5
gh workflow run publish-image.yaml --ref main -f image=todo-backend -f tag=3.5
gh run list --workflow publish-image.yaml --limit 5
```

These commands start the manual GitHub Actions builds for both GHCR images and
show their status. Wait for both builds to succeed. Packages must be public for
anonymous pulls; private packages require pull credentials.

## 2. Prepare the namespace and password

```sh
kubectl apply -f todo_app/overlays/gke/namespace.yaml
kubectl -n project get secret todo-postgres-secret
```

Create the namespace and check whether the database password already exists.
**Only if the Secret is missing on a first deployment**, run:

```sh
kubectl -n project create secret generic todo-postgres-secret \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 24)"
```

This stores a randomly generated password. Keep the existing Secret when
redeploying; generating a new password does not update an existing database.

## 3. Preview and deploy

```sh
kubectl kustomize todo_app/overlays/gke/
kubectl apply --dry-run=server -k todo_app/overlays/gke/
kubectl apply -k todo_app/overlays/gke/
```

Render the manifests, validate them without changing the cluster, then deploy
Todo, its backend, database, image-cache PVC, reading CronJob, and Gateway.
This manual configuration uses GHCR tag `3.5`, not Artifact Registry images.

```sh
kubectl -n project rollout status statefulset/todo-postgres --timeout=300s
kubectl -n project rollout status deployment/todo-backend-dep --timeout=300s
kubectl -n project rollout status deployment/todo-app-dep --timeout=300s
kubectl -n project wait --for=condition=Programmed gateway/todo-gateway --timeout=600s
kubectl -n project get pods,pvc,gateway
```

Wait for the database, both applications, and Gateway; then check Pod readiness,
bound storage, and the public address. Updates briefly interrupt service because
the Deployments use `Recreate`. Do not delete PVCs to resolve rollout problems.

## 4. Verify public access

```sh
TODO_URL="http://$(kubectl -n project get gateway todo-gateway \
  -o jsonpath='{.status.addresses[0].value}')"
curl -f "$TODO_URL/"
curl -f "$TODO_URL/image" -o /dev/null
curl -f "$TODO_URL/todos"
```

Read the Gateway address, then check the page, image download, and Todo API.
Load-balancer health checks may need several minutes after provisioning.

```sh
curl -f "$TODO_URL/todos" \
  -H 'Content-Type: application/json' \
  -d '{"text":"Verify Todo deployment"}'
```

Create a real Todo to verify submissions. Open `$TODO_URL` in a browser to use
the application.

## Troubleshooting

```sh
kubectl -n project describe pod -l app=todo-app
kubectl -n project logs deployment/todo-app-dep --tail=50
kubectl -n project describe httproute todo-route
kubectl -n project describe healthcheckpolicy todo-app-healthcheck
```

Inspect scheduling/image errors, frontend logs, route acceptance, and load-balancer
health-check configuration. See the [backend guide](../todo_backend/README.md)
for database and CronJob checks and the [storage guide](../storage/README.md)
for PVC checks.
