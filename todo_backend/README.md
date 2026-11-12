# Todo backend

A self-contained TypeScript HTTP service. Todos are stored in memory, start
empty, and are cleared when the backend restarts. No database or volume yet.

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
HOST=127.0.0.1 PORT=3001 SHUTDOWN_TIMEOUT_MS=10000 pnpm start
```

`HOST`, `PORT`, and `SHUTDOWN_TIMEOUT_MS` are required environment variables.
The Deployment supplies them explicitly; there are no source-code defaults.
Use port `3001` when running beside the frontend locally.

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
docker build -t todo-backend:2.2 ./todo_backend
docker build -t todo-app:2.2 ./todo_app
k3d image import todo-backend:2.2 todo-app:2.2 -c <cluster-name>
kubectl -n project apply -f todo_backend/manifests/
kubectl -n project rollout restart deployment/todo-backend-dep
kubectl -n project rollout status deployment/todo-backend-dep
kubectl -n project apply -f todo_app/manifests/
kubectl -n project rollout restart deployment/todo-app-dep
kubectl -n project rollout status deployment/todo-app-dep
```

The frontend still needs its existing image-cache PVC; see the
[storage guide](../storage/README.md). The backend needs no PVC. Keep one backend
replica, since each process would have a separate list.

With the existing Ingress, open `http://127.0.0.1:8081/`, add a todo, and refresh
the page to verify the backend returns it. Restarting the frontend preserves the
list; restarting the backend clears it. A database will provide persistence later.
