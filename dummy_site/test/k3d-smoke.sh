#!/usr/bin/env bash
# Requires a running controller. Test objects are removed on exit.
set -euo pipefail
k() { kubectl --context=k3d-k3d-test -n default "$@"; }
id="mirror-test-$(date +%s)-$$"
child="ds-$id-$(printf %s "$id" | sha256sum | cut -c1-8)"
cleanup() {
  k delete dummysite,networkpolicy,service,pod "$id" --ignore-not-found --wait=false
}
trap cleanup EXIT
k run "$id" --image=dummysite:5.1 --restart=Never --port=8080 --command -- node --input-type=module -e '
  import http from "node:http";
  http.createServer((req,res) => {
    if (req.url === "/pic.png") {
      res.setHeader("Content-Type", "image/png");
      res.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=", "base64"));
    } else res.end("<h1>Mirror fixture</h1><img src=\"pic.png\">");
  }).listen(8080);'
k expose pod "$id" --port=8080
k wait --for=condition=Ready pod/"$id" --timeout=60s
# Allow only this temporary site's init container to reach its local fixture.
k apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: $id}
spec:
  podSelector: {matchLabels: {dummysite-instance: $child}}
  policyTypes: [Egress]
  egress:
  - to: [{podSelector: {matchLabels: {run: $id}}}]
    ports: [{port: 8080, protocol: TCP}]
---
apiVersion: exercises.example.com/v1alpha1
kind: DummySite
metadata: {name: $id}
spec:
  website_url: http://$id:8080/
EOF
k wait --for=create deployment/"$child" --timeout=60s
k rollout status deployment/"$child" --timeout=120s
k delete pod "$id" --wait=true
proxy="/api/v1/namespaces/default/services/http:$child:http/proxy"
html=$(k get --raw "$proxy/")
[[ $html == *'Mirror fixture'* ]]
file=$(grep -oE 'images/[0-9a-f]{64}\.png' <<<"$html")
expected=$(printf %s 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=' | base64 -d | sha256sum)
[[ $(k get --raw "$proxy/$file" | sha256sum) == "$expected" ]]
k delete dummysite "$id" --cascade=foreground
k wait --for=delete deployment/"$child" service/"$child" --timeout=90s
echo 'Mirrored HTML and image verified with origin offline; child resources removed.'
