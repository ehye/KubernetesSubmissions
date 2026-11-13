# Todo backend

A TypeScript HTTP service backed by PostgreSQL 18. Todos and their UUIDs survive
backend and database Pod restarts when the database PVC is retained.

## API

| Request | Response |
| --- | --- |
| `GET /todos` | `200` with a JSON array of todos |
| `POST /todos` with `{"text":"Buy groceries"}` | `201` with the new todo |

Each todo has an `id` (UUID) and `text`. Text is trimmed, must not be blank,
and cannot exceed 140 characters, matching the frontend's input limit.
POST requests require `Content-Type: application/json`. Invalid JSON/text gets
`400`, unsupported content types get `415`, and bodies above 8 KiB get `413`.

## Run locally

From `todo_backend/`, using Node.js 26.13.0 and pnpm 12.16.1:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
export PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=todos PGUSER=todo
export PGCONNECT_TIMEOUT_MS=1000 PGSTATEMENT_TIMEOUT_MS=1000
read -rsp 'Database password: ' PGPASSWORD; echo
export PGPASSWORD
HOST=127.0.0.1 PORT=3001 SHUTDOWN_TIMEOUT_MS=10000 pnpm start
```

`HOST`, `PORT`, and `SHUTDOWN_TIMEOUT_MS` are required environment variables.
The Deployment supplies them explicitly; there are no source-code defaults.
Use port `3001` when running beside the frontend locally.

The `PG*` variables above are also required and must point to a running database.
Startup creates the `todos` table if missing, without resetting saved data.
Reads return todos in insertion order; inserts use parameterized SQL. Database
failures return JSON `503` errors. A failed startup connection exits the process
so Kubernetes can retry. Existing in-memory todos are not migrated.

`pnpm test` runs HTTP/configuration unit tests without a database. To include
database tests, point `PG*` at a **disposable test database**, then run
`TEST_DATABASE=1 pnpm test`. These tests truncate the `todos` table: never use
your real database for them.

```sh
curl http://127.0.0.1:3001/todos
curl -X POST http://127.0.0.1:3001/todos \
  -H 'Content-Type: application/json' \
  -d '{"text":"Buy groceries"}'
```

Then start `todo_app/` with `TODO_BACKEND_URL=http://127.0.0.1:3001`.
The frontend forwards its `/todos` requests to this service.

## Kubernetes

The backend listens on port `3000`. Its ClusterIP Service, `todo-backend-svc`,
exposes port `2345` and forwards to `3000`. The frontend uses:

```text
http://todo-backend-svc:2345/todos
```

The browser sends requests to the frontend's `/todos` endpoint. Only the frontend
server resolves this Kubernetes Service name; no CORS or extra Ingress is needed.

From the repository root, with kubectl targeting the same cluster as the import:

```sh
docker build -t todo-backend:2.8 ./todo_backend
docker build -t todo-app:2.6 ./todo_app
k3d image import todo-backend:2.8 todo-app:2.6 -c <cluster-name>

# Create once; do not regenerate a password for an existing database.
kubectl -n project create secret generic todo-postgres-secret \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 24)"
kubectl -n project apply -f todo_backend/manifests/postgres.yaml
kubectl -n project rollout status statefulset/todo-postgres --timeout=120s
kubectl -n project apply -f todo_backend/manifests/
kubectl -n project rollout restart deployment/todo-backend-dep
kubectl -n project rollout status deployment/todo-backend-dep
kubectl -n project apply -f todo_app/manifests/
kubectl -n project rollout restart deployment/todo-app-dep
kubectl -n project rollout status deployment/todo-app-dep
```

The frontend still needs its existing image-cache PVC; see the
[storage guide](../storage/README.md). The backend itself mounts no PVC;
PostgreSQL has separate storage and all backend processes share the database.

With the existing Ingress, open `http://127.0.0.1:8081/`, add a todo, and refresh
the page to verify the backend returns it. Restarting the frontend preserves the
list; restarting the backend also preserves it.

## PostgreSQL storage and configuration

`manifests/postgres.yaml` defines a one-replica `todo-postgres` StatefulSet,
headless Service `todo-postgres-svc`, and ConfigMap in `project`. The ConfigMap
provides database `todos` and user `todo`; both database and backend receive
the password from `todo-postgres-secret`. No password is committed to Git.
The backend Deployment supplies host, port, and timeout settings via environment
variables and maps the ConfigMap/Secret values to `PGDATABASE`, `PGUSER`, and
`PGPASSWORD`.

PostgreSQL 18 mounts a separate 1 GiB `local-path` PVC at `/var/lib/postgresql`
(its image defaults `PGDATA` to `/var/lib/postgresql/18/docker`). Do not reuse or
delete the frontend's `shared-data-pvc`. The database PVC is named
`postgres-data-todo-postgres-0`; it survives Pod/StatefulSet deletion, but deleting
it can delete its data because `local-path` uses reclaim policy `Delete`.
Node/cluster deletion can also lose local data.

`POSTGRES_*` settings initialize an empty data directory only. Changing a Secret
later does not update the password stored in an existing database.

To check persistence, create a todo in the browser, then replace each Pod in
turn and refresh after recovery:

```sh
kubectl -n project rollout restart deployment/todo-backend-dep
kubectl -n project rollout status deployment/todo-backend-dep
kubectl -n project delete pod todo-postgres-0
kubectl -n project rollout status statefulset/todo-postgres --timeout=120s
kubectl -n project exec todo-postgres-0 -- \
  psql -U todo -d todos -c 'SELECT id, text FROM todos ORDER BY position;'
```
