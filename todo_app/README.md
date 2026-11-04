# Todo app

A minimal TypeScript HTTP server for exercise 1.2

## Run

```sh
pnpm install
pnpm build
PORT=8080 pnpm start
```

## k3d deployment

After building the image, import it into an existing cluster. Replace
`<cluster-name>` and ensure kubectl targets that cluster:

```sh
k3d image import todo-app:1.2 -c <cluster-name>
kubectl create deployment todo-app --image=todo-app:1.2
kubectl set env deployment/todo-app PORT=3000
kubectl rollout status deployment/todo-app
kubectl logs -f deployment/todo-app
kubectl port-forward deployment/todo-app 8080:3000
```
