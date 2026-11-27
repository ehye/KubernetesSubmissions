# DummySite

A `DummySite` in `default` mirrors `spec.website_url` into a dedicated nginx
Deployment and ClusterIP Service. The Node.js controller lists/watches sites;
the site's init container downloads the HTML and its `<img src>` images into a
shared `emptyDir`. It resolves redirects, relative URLs and `<base href>`, and
rewrites downloaded images to local paths. This is a static snapshot, not a
crawler: scripts, external stylesheets and responsive image variants are not
mirrored. Missing images do not prevent the page from being served.

## Local k3d

From the repository root:

```sh
docker build -t dummysite:5.1 dummy_site
k3d image import dummysite:5.1 -c k3d-test
k() { kubectl --context=k3d-k3d-test -n default "$@"; }
k apply -f dummy_site/manifests/crd.yaml
k wait --for=condition=Established crd/dummysites.exercises.example.com
k apply -f dummy_site/manifests/rbac.yaml
k apply -f dummy_site/manifests/controller.yaml
k rollout status deploy/dummysite-controller
k apply -f dummy_site/manifests/example.yaml
k wait --for=create deployment/ds-example-50d858e0 --timeout=60s
k rollout status deploy/ds-example-50d858e0
k port-forward svc/ds-example-50d858e0 8085:80
```

Open <http://localhost:8085/>. Change `website_url` and reapply to roll out a
new snapshot. Deleting the DummySite garbage-collects its Deployment, Pods and
Service via owner references. A replacement Pod downloads the snapshot again.

The ServiceAccount has a namespaced Role and RoleBinding, not a ClusterRole.
The site Pods mount no API token; their egress policy allows cluster DNS and
public IPv4 HTTP/HTTPS on standard ports.

## Verify

```sh
pnpm --dir dummy_site install --frozen-lockfile
pnpm --dir dummy_site test
bash dummy_site/test/k3d-smoke.sh
```

The smoke test serves a relative PNG from a temporary origin, removes that
origin, verifies the copied image bytes through the generated Service, and
checks garbage collection. It leaves the `example` site running.
