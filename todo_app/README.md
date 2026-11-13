# Todo app

A TypeScript HTTP server with a centered photo below the Todo app heading.
The browser loads the photo from this app's `/image` endpoint, not directly
from Picsum. The todo list and Send button use the separate
[Todo backend](../todo_backend/README.md).

## Run

```sh
pnpm install --frozen-lockfile
pnpm build
HOST=127.0.0.1 PORT=8080 \
IMAGE_CACHE_FILE=./data/todo-image/image.jpg \
PICSUM_URL=https://picsum.photos/1200 \
TODO_BACKEND_URL=http://127.0.0.1:3001 \
IMAGE_CACHE_DURATION_MS=600000 IMAGE_TIMEOUT_MS=15000 \
BACKEND_TIMEOUT_MS=3000 SHUTDOWN_TIMEOUT_MS=10000 \
IMAGE_RETRY_AFTER_SECONDS=5 \
ENABLE_SHUTDOWN_TEST=false pnpm start
```

Open `http://127.0.0.1:8080/`. All runtime settings above are required;
missing or invalid settings cause a clear startup error rather than a fallback.
Use `pnpm test` to run the tests.

First start `todo_backend/` on port `3001`. The frontend loads todos from
`GET /todos` and sends `POST /todos` with JSON when the form is submitted.
Its Node server forwards those requests to `TODO_BACKEND_URL`.
In Kubernetes `manifests/configmap.yaml` sets it to
`http://todo-backend-svc:2345`, which forwards to backend port `3000`.

The browser always uses relative `/todos` URLs; it does not contact a Kubernetes
Service name directly. Todo text is limited to 140 characters in both apps and
rendered as text, not HTML. The page shows loading, empty-list, and backend errors.
The backend stores todos in PostgreSQL and preserves them on restart. The
frontend's persistent image cache is separate and unchanged.

## Ten-minute image cache

- On the first image request, download a random JPEG from `https://picsum.photos/1200`.
- Store the image at `./data/todo-image/image.jpg` locally, or
  `/shared/todo-image/image.jpg` in Kubernetes.
- Reuse it for ten minutes, including after process/container restarts. The file's
  modification time records when it was downloaded; reads do not reset its age.
- On the first image request after expiry, download and serve a fresh random
  image. This is request-driven, not an hourly background job. Refresh the page
  to see updates; the page does not automatically reload.
- Concurrent requests share one download. A temporary file and atomic rename
  prevent a crash from replacing the cached image with an incomplete download.
- If refresh fails, serve the previous image. If there is no cached image,
  `/image` returns `503` and can be retried.

`IMAGE_CACHE_FILE` supplies the file path and `PICSUM_URL` supplies the source URL.
`IMAGE_CACHE_DURATION_MS`, `IMAGE_TIMEOUT_MS`, and `BACKEND_TIMEOUT_MS` control
cache lifetime and request timeouts. `HOST`, `PORT`, `SHUTDOWN_TIMEOUT_MS`, and
`ENABLE_SHUTDOWN_TEST` control listening and shutdown behavior.
`IMAGE_RETRY_AFTER_SECONDS` supplies the retry hint when no cached image is available.

The Deployment imports these settings from `todo-app-config` with `envFrom`.
After editing the ConfigMap, apply it and restart the Deployment so new Pods
receive the changed environment. Relative browser routes such as `/todos` and
the 140-character validation rule remain application logic, not deployment settings.

## k3d deployment

Run from the repository root. Replace `<cluster-name>` and ensure kubectl targets
that cluster. First prepare the existing PV/PVC and its directory using the
[storage guide](../storage/README.md).

First create the PostgreSQL password Secret and start the database using the
[backend deployment instructions](../todo_backend/README.md#kubernetes).

```sh
docker build -t todo-backend:2.8 ./todo_backend
docker build -t todo-app:2.6 ./todo_app
k3d image import todo-backend:2.8 todo-app:2.6 -c <cluster-name>
kubectl -n project apply -f todo_backend/manifests/
kubectl -n project rollout restart deployment/todo-backend-dep
kubectl -n project rollout status deployment/todo-backend-dep
kubectl -n project apply -f todo_app/manifests/
kubectl -n project rollout restart deployment/todo-app-dep
kubectl -n project rollout status deployment/todo-app-dep
kubectl -n project logs -f deployment/todo-app-dep
```

With the existing Ingress and k3d port mapping, open `http://127.0.0.1:8081/`.
Todo mounts `shared-data-pvc` in the `project` namespace,
but only writes inside `todo-image/`. It uses one replica with `Recreate` to avoid
overlapping image downloads during deployment updates. PostgreSQL uses a separate
PVC; it never mounts or modifies this image cache.

## Test a container crash

The test-only endpoint is disabled by default. **While enabled, anyone who can
reach the app can stop it**, so use it only for this exercise and disable it after testing.

```sh
kubectl -n project set env deployment/todo-app-dep ENABLE_SHUTDOWN_TEST=true
kubectl -n project rollout status deployment/todo-app-dep

# Populate the cache and record its checksum.
curl -f http://127.0.0.1:8081/image -o /dev/null
kubectl -n project exec deployment/todo-app-dep -- sha256sum /shared/todo-image/image.jpg

# Responds with 202, then immediately exits the process with code 1.
curl -X POST http://127.0.0.1:8081/_test/shutdown
kubectl -n project get pods -l app=todo-app --watch
```

Kubernetes restarts the container. Once it is running, stop watching with Ctrl+C,
refresh the page, and compare the checksum again. Within ten minutes of download,
it should be unchanged and no new image is downloaded. Repeated crashes may cause
Kubernetes to delay restarts.

```sh
kubectl -n project exec deployment/todo-app-dep -- sha256sum /shared/todo-image/image.jpg
kubectl -n project set env deployment/todo-app-dep ENABLE_SHUTDOWN_TEST=false
kubectl -n project rollout status deployment/todo-app-dep
```

For local testing, use the full environment from the Run example with
`ENABLE_SHUTDOWN_TEST=true`,
then POST to `http://127.0.0.1:8080/_test/shutdown` and start the app again using
the same cache path. A local process is not automatically restarted by Kubernetes.
