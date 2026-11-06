# Log output

Two containers in one Pod share a persistent volume with the separate Ping-pong Pod:

- **writer:** generates a startup UUID and replaces `/shared/log.txt` immediately
  and every five seconds. It writes a temporary file and renames it atomically.
- **reader:** reads that file and `/shared/pingpong-count.txt` on each HTTP request,
  returning the latest log line followed by `Ping / Pongs: <total>`.
  The volume is mounted read-only in this container.

Only the latest line is stored, not a growing history. Restarting the writer
generates a new UUID; restarting the reader does not change the file. The shared
files survive container and Pod replacement. Ping-pong persists its request count
separately; restarting the Log output writer never resets that count.

### Run

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start:writer
```

In a second terminal, from the same directory:

```sh
pnpm start
```

Both processes default to `./data/log.txt`. Set `LOG_FILE` to the same path for
both processes to override it. Use `pnpm dev:writer` and `pnpm dev` for watch mode.
The reader defaults to `pingpong-count.txt` beside the log file; use `COUNTER_FILE`
to override that path. For local sharing, point it to the file used by Ping-pong.

Open `http://localhost:3000/` to see the latest logged timestamp and startup UUID.
The timestamp updates with the five-second logging interval, not on each request.
Set `PORT` to override the default listening port of `3000`.
Before the writer creates the file, the reader returns `503` with `Retry-After: 1`.
Other file-read failures return `500`. The reader never creates or modifies the file.
A missing counter file means zero; a malformed counter produces `500`.

Run tests with `pnpm test`.

Example output:

```text
2020-03-30T12:15:17.705Z: 8523ecb1-c716-4cb6-a044-b9e83bb98e43.
Ping / Pongs: 3
```

### Docker 

Build the image

```sh
docker build -t log-output:1.11 .
```

Both containers use this image. The Deployment runs `node dist/writer.js` in the
writer and `node dist/index.js` in the reader. The image's default command starts
only the reader, so running it alone requires a file supplied by a writer.

### k3d deployment

Follow the [shared storage guide](../storage/README.md) to create the PV and PVC
and deploy both applications. Once the PVC exists, from `log_output/`:

```sh
k3d image import log-output:1.11 -c <cluster-name>
kubectl apply -f manifests/
kubectl rollout status deployment/randomstring-dep
kubectl logs -f deployment/randomstring-dep -c writer
```

The Docker image runs as the `node` user (UID/GID `1000`). Prepare the node
directory's ownership manually as described in the storage guide. Only
the reader listens on port `3000`, so the existing
Service selector, Service port, and Ingress routes remain unchanged.

Log output now shares an Ingress with Ping-pong on the dedicated Traefik
`log-output` entrypoint. Follow the [Ping-pong deployment guide](../ping_pong/README.md)
to configure this listener and deploy both applications. The existing cluster
maps host port `8082` to load balancer port `30080`; with that configuration,
open `http://127.0.0.1:8082/` for Log output or
`http://127.0.0.1:8082/pingpong` for Ping-pong. Todo remains on port `8081`.

Traffic flows through Ingress `/` to `log-output-svc:2345`, then to the app on
port `3000`. No NodePort Service is needed.

The writer also logs each successfully published line to stdout. Each writer
process (and therefore each Pod replica) generates its own UUID.
