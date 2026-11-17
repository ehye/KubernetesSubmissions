# KubernetesSubmissions

## Manual deployment guides

Run deployment commands from the repository root. Install and authenticate
`gcloud`, `kubectl`, and `gh` before using the guides.

| Application | Guide |
| --- | --- |
| Todo frontend, backend, database, and Gateway | [Todo app](todo_app/README.md) |
| Todo API, database checks, and reading job | [Todo backend](todo_backend/README.md) |
| Ping-pong and its database | [Ping-pong](ping_pong/README.md) |
| Log output and shared Gateway | [Log output](log_output/README.md) |
| PVC checks and local k3d storage | [Storage](storage/README.md) |

### Select the GKE cluster

```sh
gcloud container clusters get-credentials dwk-cluster \
  --zone=us-west2-b --project=dwk-gke-514607
kubectl config current-context
```

Load the cluster credentials and confirm kubectl targets
`gke_dwk-gke-514607_us-west2-b_dwk-cluster`, not the local k3d cluster.

```sh
kubectl get gatewayclass gke-l7-global-external-managed
```

Check that Gateway API is available. If it has not been enabled yet:

```sh
gcloud container clusters update dwk-cluster \
  --zone=us-west2-b --project=dwk-gke-514607 --gateway-api=standard
```

Enable Gateway API, then repeat the GatewayClass check after provisioning.
Deployment commands create billable cloud resources. Preserve existing database
Secrets and PVCs when redeploying.

## Exercises

### Chapter 2

- [1.1.](https://github.com/ehye/KubernetesSubmissions/tree/1.1/log_output)
- [1.2.](https://github.com/ehye/KubernetesSubmissions/tree/1.2/todo_app)
- [1.3.](https://github.com/ehye/KubernetesSubmissions/tree/1.3/log_output)
- [1.4.](https://github.com/ehye/KubernetesSubmissions/tree/1.4/todo_app)
- [1.5.](https://github.com/ehye/KubernetesSubmissions/tree/1.5/todo_app)
- [1.6.](https://github.com/ehye/KubernetesSubmissions/tree/1.6/todo_app)
- [1.7.](https://github.com/ehye/KubernetesSubmissions/tree/1.7/log_output)
- [1.8.](https://github.com/ehye/KubernetesSubmissions/tree/1.8/todo_app)
- [1.9.](https://github.com/ehye/KubernetesSubmissions/tree/1.9/ping_pong)
- [1.10.](https://github.com/ehye/KubernetesSubmissions/tree/1.10/log_output)
- [1.11.](https://github.com/ehye/KubernetesSubmissions/tree/1.11/storage)
- [1.12.](https://github.com/ehye/KubernetesSubmissions/tree/1.12/todo_app)
- [1.13.](https://github.com/ehye/KubernetesSubmissions/tree/1.13/todo_app)

### Chapter 3

- [2.1.](https://github.com/ehye/KubernetesSubmissions/tree/2.1/log_output)
- [2.2.](https://github.com/ehye/KubernetesSubmissions/tree/2.2/todo_backend)
- [2.3.](https://github.com/ehye/KubernetesSubmissions/tree/2.3/log_output)
- [2.4.](https://github.com/ehye/KubernetesSubmissions/tree/2.4/todo_app)
- [2.5.](https://github.com/ehye/KubernetesSubmissions/tree/2.5/log_output)
- [2.6.](https://github.com/ehye/KubernetesSubmissions/tree/2.6/todo_app)
- [2.7.](https://github.com/ehye/KubernetesSubmissions/tree/2.7/ping_pong)
- [2.8.](https://github.com/ehye/KubernetesSubmissions/tree/2.8/todo_backend)
- [2.9.](https://github.com/ehye/KubernetesSubmissions/tree/2.9/todo_backend)
- [2.10.](https://github.com/ehye/KubernetesSubmissions/tree/2.10/todo_backend)

### Chapter 4

- [3.1.](https://github.com/ehye/KubernetesSubmissions/tree/3.1/ping_pong)
- [3.2.](https://github.com/ehye/KubernetesSubmissions/tree/3.2/log_output)
- [3.3.](https://github.com/ehye/KubernetesSubmissions/tree/3.3/log_output)
- [3.4.](https://github.com/ehye/KubernetesSubmissions/tree/3.4/log_output)
- [3.5.](https://github.com/ehye/KubernetesSubmissions/tree/3.5/todo_app)
- [3.6.](https://github.com/ehye/KubernetesSubmissions/tree/3.6/todo_app)
