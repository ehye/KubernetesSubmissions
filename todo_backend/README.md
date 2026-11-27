# Todo backend

Run commands from the repository root, with kubectl targeting GKE.
Use the [Todo deployment guide](../todo_app/README.md) to publish images, prepare
the database Secret, and deploy the complete application.

## Redeploy manually

```sh
kubectl apply -k todo_app/overlays/gke/
kubectl -n project rollout status statefulset/todo-postgres --timeout=300s
kubectl -n project rollout status deployment/todo-backend-dep --timeout=300s
```

Apply the GKE configuration and wait for the database and backend. This also
applies the frontend and Gateway resources; it does not rotate the password.

## Demo backend autoscaling

After deploying the GKE overlay, check that CPU metrics are available and watch
the autoscaler:

```sh
kubectl -n project top pods -l app=todo-backend
kubectl -n project get hpa todo-backend-hpa --watch
```

The backend scales from 1 to 3 Pods at a target of 50% of the `50m` CPU request
(about `25m` per Pod). In another terminal, send concurrent read-only requests
through the backend Service so Kubernetes can distribute them across replicas:

```sh
kubectl -n project run todo-hpa-demo --rm -i --restart=Never \
  --image=busybox:1.37 -- sh -c '
    end=$(( $(date +%s) + 90 ))
    pids=""
    for worker in 1 2 3 4; do
      (
        while [ "$(date +%s)" -lt "$end" ]; do
          wget -q -T 5 -O /dev/null http://todo-backend-svc:2345/todos || exit 1
        done
      ) &
      pids="$pids $!"
    done
    result=0
    for pid in $pids; do wait "$pid" || result=1; done
    exit "$result"
  '
```

Repeat if the CPU load did not last long enough to register. Once traffic stops,
scale-down can take several minutes. Use
`kubectl -n project describe hpa todo-backend-hpa` to inspect scaling decisions or
missing metrics.

## Demo the disruption budget

After deploying the GKE overlay, run this in another terminal during the
autoscaling demo:

```sh
kubectl -n project get pdb todo-backend-pdb --watch
```

Watch `ALLOWED DISRUPTIONS`: with one Ready backend Pod, it is normally `0`;
with two Ready Pods, it is normally `1`. The budget can block a node drain
when only one backend Pod is Ready. It does not prevent crashes or
Deployment-driven Pod replacement.

## Test the backend directly

```sh
kubectl -n project port-forward service/todo-backend-svc 3001:2345
```

Forward local port `3001` to the backend Service. Keep this command running and
use another terminal:

```sh
curl -f http://127.0.0.1:3001/todos
curl -f http://127.0.0.1:3001/todos \
  -H 'Content-Type: application/json' \
  -d '{"text":"Verify backend access"}'
```

List saved Todos, then create a real Todo. Stop port-forwarding with Ctrl+C.

## Check database persistence

```sh
kubectl -n project rollout restart deployment/todo-backend-dep
kubectl -n project rollout status deployment/todo-backend-dep --timeout=300s
kubectl -n project exec todo-postgres-0 -- \
  psql -U todo -d todos -c 'SELECT id, text FROM todos ORDER BY position;'
```

Restart the backend, wait for recovery, and read saved Todos directly from
PostgreSQL. Existing Todos should remain. Do not delete the database PVC or
replace its password Secret.

## Run the reading CronJob manually

```sh
JOB_NAME="todo-reading-test-$(date +%s)"
kubectl -n project create job --from=cronjob/todo-reading "$JOB_NAME"
kubectl -n project wait --for=condition=complete "job/$JOB_NAME" --timeout=90s
kubectl -n project logs "job/$JOB_NAME"
```

Start a uniquely named run without waiting for the hourly schedule, wait for
completion, and inspect its output. A successful run creates a real reading Todo.

## Troubleshooting

```sh
kubectl -n project get pods,pvc,cronjob
kubectl -n project logs deployment/todo-backend-dep --tail=50
kubectl -n project logs todo-postgres-0 --tail=50
kubectl -n project describe pod -l app=todo-backend
```

Check readiness and storage, inspect backend/database errors, and examine Pod
events. Submitted Todo text appears in backend logs; do not submit sensitive data.

## Daily database backup

`todo-backup` runs daily at **02:00 UTC**, saving plain SQL as
`gs://dwk-project-bakcup-bucket/<namespace>/backup-yyyy-MM-dd.sql`.
Existing same-day backups are not overwritten; a duplicate upload fails.

### Prepare cloud credentials

```sh
kubectl -n project create secret generic todo-backup-gcs-secret \
  --from-file=key.json=key.json
```

First deployment only: store the downloaded service-account JSON key in a
Kubernetes Secret. Keep `key.json` out of Git. The configured account is
`dwk-storage-sa@dwk-gke-514607.iam.gserviceaccount.com`.
Keep an existing Secret unless intentionally rotating credentials.

### Deploy and test

```sh
kubectl apply -f todo_app/backup/backup-cronjob.yaml
kubectl -n project get cronjob todo-backup
JOB_NAME="todo-backup-test-$(date +%s)"
kubectl -n project create job --from=cronjob/todo-backup "$JOB_NAME"
kubectl -n project wait --for=condition=complete "job/$JOB_NAME" --timeout=900s
kubectl -n project logs "job/$JOB_NAME" -c dump
kubectl -n project logs "job/$JOB_NAME" -c upload
```

Apply the backup configuration without changing application images, inspect its
schedule, then run and check a backup immediately. Run the test only if today's
backup does not already exist. Failed dumps are not uploaded.
The CronJob is also included in `kubectl apply -k todo_app/overlays/gke/`.

```sh
gcloud storage ls gs://dwk-project-bakcup-bucket/project/
gcloud storage cp \
  gs://dwk-project-bakcup-bucket/project/backup-YYYY-MM-DD.sql \
  ./backup-YYYY-MM-DD.sql
```

List backups and download one, replacing `YYYY-MM-DD` with its UTC date.
Restore with `psql -v ON_ERROR_STOP=1 -d <empty-test-database> -f <backup-file>`;
use a disposable database, not the running Todo database.

Credentials are required in each namespace where backups run. No retention
policy is added; objects remain until removed or a bucket lifecycle rule expires
them. Namespace deletion does not delete the Cloud Storage backups.

## Database hosting comparison

Compare Cloud SQL for PostgreSQL with a PostgreSQL container + PVC on GKE.

| Area | Cloud SQL | PostgreSQL + PVC on GKE |
| --- | --- | --- |
| Initial work | Instance, users, networking/IAM, backups | StatefulSet, Service, Secret, PVC, probes, backups |
| Setup fee | No | No |
| Ongoing cost | Compute, storage, backups, networking; extra for HA | Compute, disks, backups, administration |
| Maintenance | Google | Self manage everything |
| Control | Restricted versions, extensions, privileges | Full configuration control |

### Backups

| Method | Cloud SQL | PostgreSQL + PVC on GKE |
| --- | --- | --- |
| Scheduled backups | Managed schedule/retention | Jobs, external storage, retention, alerts |
| Point-in-time recovery | Managed when enabled | Base backups + WAL archiving; more effort |
| Logical backups | Exports or dump tools | `pg_dump` / `pg_restore` |
| Restore | Managed tooling; easier | Manual environment/data restore |

### Cost example

Illustrative `us-central1` list prices, USD/month, 730 hours; excludes backups
and networking. Prices checked November 2026:

- **Cloud SQL:** approximately **$9.37** for shared-core development sizing with
  10 GiB SSD; no SLA.
- **Cloud SQL:** approximately **$51** for 1 dedicated vCPU, 3.75 GiB RAM, and
  10 GiB SSD.
- **GKE:** approximately **$1 for a 10 GiB balanced disk**, **plus compute and
  administration**.

These are not equivalent configurations or quotes for this project's cluster.
See [Cloud SQL pricing](https://cloud.google.com/sql/pricing) and
[disk pricing](https://cloud.google.com/compute/disks-image-pricing).

### Choose Cloud SQL when…

- Production data and recovery reliability matter.
- Wants less database maintenance.
- Managed backups and high Availability.

### Choose PostgreSQL + PVC on GKE when…

- Existing GKE capacity keeps costs low.
- Need more control and can maintain backups, upgrades, and recovery.

### Summary

**Cloud SQL trades higher infrastructure cost for less operational work.
PostgreSQL on GKE offers control and potentially lower costs, but more
responsible for database reliability.**

For this project: **PostgreSQL + PVC on GKE for learning/branch environments;
Cloud SQL for production data.**
