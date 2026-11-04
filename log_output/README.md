# Log output

### Run

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Example output:

```text
2020-03-30T12:15:17.705Z: 8523ecb1-c716-4cb6-a044-b9e83bb98e43
2020-03-30T12:15:22.705Z: 8523ecb1-c716-4cb6-a044-b9e83bb98e43
```

### Docker 

Build the image

```sh
docker build -t log-output:1
```

### k3d deployment

After building docker image, import it into existing k3d cluster and create a deployment

```sh
k3d image import log-output:1 -c <cluster-name>
kubectl create deployment log-output --image=log-output:1
kubectl logs -f deployment/log-output
```

The application writes to stdout, each container or replica generates its own UUID
