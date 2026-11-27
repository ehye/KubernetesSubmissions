#!/usr/bin/env bash
# Run from the source checkout; gitops/ is the separate App-authenticated checkout.
set -euo pipefail
target=$1 commit=$2 images=$3
[[ $target == staging || $target == production ]]
[[ $commit =~ ^[a-f0-9]{40}$ && $GITHUB_RUN_NUMBER =~ ^[0-9]+$ ]]
cd gitops
record="builds/$commit.json"
promotion="promotions/$target.json"
kustomization="overlays/$target/kustomization.yaml"
# A release tag can arrive while staging is still publishing this commit.
if [[ $target == production && ! -f $record ]]; then
  for delay in {1..12}; do
    echo "Waiting for staging to record $commit ($delay/12)"
    sleep 10
    git fetch --quiet origin main
    git reset --hard FETCH_HEAD
    [[ ! -f $record ]] || break
  done
fi
for attempt in {1..5}; do
  git fetch --quiet origin main
  git reset --hard FETCH_HEAD
  previous=$(jq -er .run "$promotion")
  if (( previous >= GITHUB_RUN_NUMBER )); then echo "Already promoted by run $previous"; exit 0; fi
  # Only staging creates build records. Tags reuse the exact staged digests.
  if [[ ! -f $record ]]; then
    if [[ $target != staging ]]; then echo "No staged build for $commit" >&2; exit 1; fi
    cp "$images" "$record"
  fi
  jq -e 'sort_by(.name) | map(.name) == ["broadcaster","todo-app","todo-backend"]' "$record" >/dev/null
  jq -e 'all(.[]; .newName == ("ghcr.io/ehye/" + .name) and (.digest | test("^sha256:[0-9a-f]{64}$")))' "$record" >/dev/null
  jq --slurpfile images "$record" '.images = $images[0]' "$kustomization" > "$RUNNER_TEMP/kustomization.json"
  mv "$RUNNER_TEMP/kustomization.json" "$kustomization"
  kubectl kustomize "overlays/$target" >/dev/null
  jq -n --arg commit "$commit" --argjson run "$GITHUB_RUN_NUMBER" '{commit:$commit,run:$run}' > "$promotion"
  git add "$record" "$promotion" "$kustomization"
  git -c user.name='todo-gitops-bot[bot]' -c user.email='todo-gitops-bot[bot]@users.noreply.github.com' \
    commit -m "Promote $target from $commit"
  if git push origin HEAD:main; then exit 0; fi
done
exit 1
