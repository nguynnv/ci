
#!/bin/bash

set -e

echo "=== Updating source code ==="
git pull

echo "=== Installing dependencies ==="
npm install

echo "=== Restarting processes ==="
pm2 reload ecosystem.config.cjs --update-env

echo "=== Deployment completed ==="
pm2 save
