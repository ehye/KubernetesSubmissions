# Todo app

A TypeScript HTTP server with a centered photo below the Todo app heading.
The browser loads the photo from this app's `/image` endpoint, not directly
from Picsum. The todo list and Send button use the separate
[Todo backend](../todo_backend/README.md).

## Run

```sh
pnpm install --frozen-lockfile
pnpm build
TODO_BACKEND_URL=http://127.0.0.1:3001 PORT=8080 pnpm start
```

Open `http://127.0.0.1:8080/`. `PORT` defaults to `3000` when not specified.
Use `pnpm test` to run the tests.

First start `todo_backend/` on port `3001`. The frontend loads todos from
`GET /todos` and sends `POST /todos` with JSON when the form is submitted.
Its Node server forwards those requests to `TODO_BACKEND_URL` (locally defaulting
to `http://127.0.0.1:3001`). In Kubernetes the Deployment sets it to
`http://todo-backend-svc:2345`, which forwards to backend port `3000`.

The browser always uses relative `/todos` URLs; it does not contact a Kubernetes
Service name directly. Todo text is limited to 140 characters in both apps and
rendered as text, not HTML. The page shows loading, empty-list, and backend errors.
The backend starts with an empty list and loses its todos on restart. The
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

`IMAGE_CACHE_FILE` overrides the image file path. `PICSUM_URL` optionally overrides
the source URL (useful for a local test server). Downloads time out after 15 seconds.

## k3d deployment

Run from the repository root. Replace `<cluster-name>` and ensure kubectl targets
that cluster. First prepare the existing PV/PVC and its directory using the
[storage guide](../storage/README.md).

```sh
docker build -t todo-backend:2.2 ./todo_backend
docker build -t todo-app:2.2 ./todo_app
k3d image import todo-backend:2.2 todo-app:2.2 -c <cluster-name>
kubectl -n default apply -f todo_backend/manifests/
kubectl -n default rollout status deployment/todo-backend-dep
kubectl -n default apply -f todo_app/manifests/
kubectl -n default rollout status deployment/todo-app-dep
kubectl -n default logs -f deployment/todo-app-dep
```

With the existing Ingress and k3d port mapping, open `http://127.0.0.1:8081/`.
Todo mounts `shared-data-pvc` in the same namespace as the other applications,
but only writes inside `todo-image/`. It uses one replica with `Recreate` to avoid
overlapping image downloads during deployment updates. No extra PV/PVC is needed.

## Test a container crash

The test-only endpoint is disabled by default. **While enabled, anyone who can
reach the app can stop it**, so use it only for this exercise and disable it after testing.

```sh
kubectl -n default set env deployment/todo-app-dep ENABLE_SHUTDOWN_TEST=true
kubectl -n default rollout status deployment/todo-app-dep

# Populate the cache and record its checksum.
curl -f http://127.0.0.1:8081/image -o /dev/null
kubectl -n default exec deployment/todo-app-dep -- sha256sum /shared/todo-image/image.jpg

# Responds with 202, then immediately exits the process with code 1.
curl -X POST http://127.0.0.1:8081/_test/shutdown
kubectl -n default get pods -l app=todo-app --watch
```

Kubernetes restarts the container. Once it is running, stop watching with Ctrl+C,
refresh the page, and compare the checksum again. Within ten minutes of download,
it should be unchanged and no new image is downloaded. Repeated crashes may cause
Kubernetes to delay restarts.

```sh
kubectl -n default exec deployment/todo-app-dep -- sha256sum /shared/todo-image/image.jpg
kubectl -n default set env deployment/todo-app-dep ENABLE_SHUTDOWN_TEST=false
kubectl -n default rollout status deployment/todo-app-dep
```

For local testing, start with `ENABLE_SHUTDOWN_TEST=true PORT=8080 pnpm start`,
then POST to `http://127.0.0.1:8080/_test/shutdown` and start the app again using
the same cache path. A local process is not automatically restarted by Kubernetes.
