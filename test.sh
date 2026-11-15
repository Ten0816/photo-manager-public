#!/bin/bash
set -e

docker compose run --rm --no-deps \
  -v "$PWD:/app" \
  -v /app/node_modules \
  photo-manager \
  npm test
