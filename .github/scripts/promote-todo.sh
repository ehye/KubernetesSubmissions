#!/usr/bin/env bash
# Fast-forward only. A slow build must not replace a newer successful promotion.
set -euo pipefail
[[ $1 == staging || $1 == production ]]
branch="deploy/$1"
manifest=$(realpath "$2")
commit=$(git rev-parse HEAD)
dir=$(mktemp -d)
git worktree add --quiet --detach "$dir" HEAD
trap 'git worktree remove --force "$dir"' EXIT
for attempt in {1..5}; do
  if git ls-remote --exit-code --heads origin "refs/heads/$branch" >/dev/null; then
    git fetch --quiet origin "refs/heads/$branch"
    git -C "$dir" checkout --quiet --detach "$(git rev-parse FETCH_HEAD)"
    previous=$(cat "$dir/run-number")
    if (( previous >= GITHUB_RUN_NUMBER )); then
      echo "Run $previous already deployed; skipping run $GITHUB_RUN_NUMBER"
      exit 0
    fi
  else
    [[ $? == 2 ]] || exit 1
    git -C "$dir" switch --quiet --orphan "bootstrap-$1-$GITHUB_RUN_ID-$attempt"
  fi
  mkdir -p "$dir/manifests"
  cp "$manifest" "$dir/manifests/todo.yaml"
  echo "$GITHUB_RUN_NUMBER" > "$dir/run-number"
  git -C "$dir" add manifests/todo.yaml run-number
  git -C "$dir" -c user.name=github-actions -c user.email=github-actions@users.noreply.github.com \
    commit --quiet -m "Deploy $1 from $commit"
  if git push origin "$(git -C "$dir" rev-parse HEAD):refs/heads/$branch"; then exit 0; fi
done
exit 1
