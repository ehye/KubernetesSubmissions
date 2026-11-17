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
