#!/usr/bin/env bash
# Usage: render-todo.sh ENV FRONTEND_REF BACKEND_REF BROADCASTER_REF
set -euo pipefail
[[ $# == 4 && ($1 == staging || $1 == production) ]]
root=$(git rev-parse --show-toplevel)
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
cat > "$dir/kustomization.yaml" <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - $(realpath --relative-to="$dir" "$root/todo_app/overlays/$1")
images:
EOF
shift
for ref in "$@"; do
  [[ $ref =~ ^(ghcr\.io/[a-z0-9._-]+/(todo-app|todo-backend|broadcaster))@(sha256:[0-9a-f]{64})$ ]]
  printf '  - name: %s\n    newName: %s\n    digest: %s\n' \
    "${BASH_REMATCH[2]}" "${BASH_REMATCH[1]}" "${BASH_REMATCH[3]}" >> "$dir/kustomization.yaml"
done
kubectl kustomize "$dir"
