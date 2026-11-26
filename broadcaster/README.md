# Todo broadcaster

After a successful insert or a change from unfinished to done, `todo-backend`
publishes `{"user":"bot","message":"A todo was created"}` (or `A todo was updated`)
on Core NATS subject `todos.status`. All broadcaster Pods subscribe in the same
`broadcaster` queue group, so only one handles each publication. It sends one
Discord webhook POST with `username` and `content` and never retries. If NATS
or Discord is unavailable a notification may be lost; the Todo write still succeeds.

## Run on local k3d

With the Todo app in `project` and NATS at `my-nats.nats:4222`, run from the
repository root:

```sh
docker build -t todo-backend:4.6 todo_backend
docker build -t broadcaster:4.6 broadcaster
k3d image import todo-backend:4.6 broadcaster:4.6 -c k3d-test
kubectl --context=k3d-k3d-test apply -f todo_backend/manifests/deployment.yaml
kubectl --context=k3d-k3d-test -n project rollout status deploy/todo-backend-dep
```

To verify without Discord, run `bash broadcaster/test/k3d-smoke.sh` **before**
deploying the real subscribers. It starts six workers and a recording webhook
in a temporary namespace, creates one test Todo and marks it done twice
concurrently. Even though the webhook times out after recording the update,
the test expects exactly two notifications. The temporary namespace is removed
on exit; the completed test Todo remains.

To use Discord, set `DISCORD_WEBHOOK_URL` in your shell and run:

```sh
printf '%s' "${DISCORD_WEBHOOK_URL:?Set your Discord webhook URL first}" |
  kubectl --context=k3d-k3d-test -n project create secret generic broadcaster-discord \
    --from-file=DISCORD_WEBHOOK_URL=/dev/stdin
kubectl --context=k3d-k3d-test apply -f broadcaster/manifests/
kubectl --context=k3d-k3d-test -n project rollout status deploy/broadcaster
```
