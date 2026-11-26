#!/usr/bin/env bash
# Requires the local images, an updated Todo backend, and NATS. Use before
# deploying the real broadcaster: the test uses the production queue group.
set -euo pipefail
cd "$(dirname "$0")/../.."
k() { kubectl --context=k3d-k3d-test "$@"; }
if [[ -n $(k get pods -A -l app=broadcaster -o name) ]]; then
  echo 'Run on a test cluster without other broadcaster consumers.' >&2
  exit 1
fi
ns=broadcaster-test-$(date +%s)
k create namespace "$ns"
trap 'k delete namespace "$ns" --wait=false' EXIT
n() { k -n "$ns" "$@"; }
n run recorder --image=broadcaster:4.6 --image-pull-policy=Never --restart=Never --command -- \
  node --input-type=module -e '
    import http from "node:http";
    const calls = [];
    http.createServer(async (req,res) => {
      if (req.method === "GET") return res.end(JSON.stringify(calls));
      let body = ""; for await (const chunk of req) body += chunk;
      const data = JSON.parse(body); calls.push(data);
      // Record the update but never acknowledge it: simulate an ambiguous timeout.
      if (data.content !== "A todo was updated") res.writeHead(204).end();
    }).listen(8080);'
n expose pod recorder --port=8080
n wait --for=condition=Ready pod/recorder --timeout=60s
n create secret generic broadcaster-discord --from-literal=DISCORD_WEBHOOK_URL=http://recorder:8080/webhook
sed "s/^  namespace: project$/  namespace: $ns/" broadcaster/manifests/deployment.yaml | n apply -f -
n rollout status deployment/broadcaster --timeout=120s
for ((i=0;i<30;i++)); do
  subscribers=$(n logs -l app=broadcaster --prefix --tail=5 | grep -c 'Subscribed to todos.status' || true)
  [[ $subscribers == 6 ]] && break
  sleep 1
done
[[ $subscribers == 6 ]]
n exec recorder -- node --input-type=module -e '
  import assert from "node:assert/strict";
  const api = "http://todo-backend-svc.project:2345/todos";
  const send = (url,method,data) => fetch(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const saved = await send(api,"POST",{text:"Broadcast verification"});
  assert.equal(saved.status,201);
  const {id} = await saved.json();
  const updates = await Promise.all([1,2].map(() => send(`${api}/${id}`,"PUT",{done:true})));
  assert.deepEqual(updates.map(r=>r.status),[200,200]);
  const read = async () => (await fetch("http://localhost:8080")).json();
  for(let i=0;i<30 && (await read()).length<2;i++) await new Promise(r=>setTimeout(r,200));
  await new Promise(r=>setTimeout(r,7000)); // longer than webhook timeout
  const calls = await read();
  assert.deepEqual(calls.map(x=>x.username),["bot","bot"]);
  assert.deepEqual(calls.map(x=>x.content).sort(),["A todo was created","A todo was updated"]);
  console.log("Six subscribers; exactly one created and one updated webhook request, including timeout.");
'
