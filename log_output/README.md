# Log output

### Run

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open `http://localhost:3000/` to see the latest logged timestamp and startup UUID.
The timestamp updates with the five-second logging interval, not on each request.
Set `PORT` to override the default listening port of `3000`.

Example output:

```text
2020-03-30T12:15:17.705Z: 8523ecb1-c716-4cb6-a044-b9e83bb98e43
2020-03-30T12:15:22.705Z: 8523ecb1-c716-4cb6-a044-b9e83bb98e43
```

### Docker 

Build the image

```sh
docker build -t log-output:1.7 .
```

### k3d deployment

After building the image, import it into the existing k3d cluster. Ensure kubectl
targets the same cluster, then apply the Deployment, Service, and Ingress:

```sh
k3d image import log-output:1.7 -c <cluster-name>
kubectl apply -f manifests/
kubectl rollout status deployment/randomstring-dep
kubectl logs -f deployment/randomstring-dep
```

Log output now shares an Ingress with Ping-pong on the dedicated Traefik
`log-output` entrypoint. Follow the [Ping-pong deployment guide](../ping_pong/README.md)
to configure this listener and deploy both applications. The existing cluster
maps host port `8082` to load balancer port `30080`; with that configuration,
open `http://127.0.0.1:8082/` for Log output or
`http://127.0.0.1:8082/pingpong` for Ping-pong. Todo remains on port `8081`.

Traffic flows through Ingress `/` to `log-output-svc:2345`, then to the app on
port `3000`. No NodePort Service is needed.

The application writes to stdout, each container or replica generates its own UUID
