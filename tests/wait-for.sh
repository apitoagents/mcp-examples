#!/usr/bin/env sh
# Wait until a URL answers 2xx, for up to 60 seconds. Usage: wait-for.sh URL
url="$1"
i=0
while [ "$i" -lt 60 ]; do
  if curl -sf "$url" >/dev/null 2>&1; then
    echo "ready: $url"
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done
echo "timed out waiting for $url" >&2
exit 1
