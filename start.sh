#!/bin/bash
echo "Starting Serverless Architecture..."

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

echo "1/3 Starting daemons (requires sudo)..."
sudo service docker start
sudo service containerd start
# Try to start faasd services if they exist as services
sudo service faasd-provider start 2>/dev/null
sudo service faasd start 2>/dev/null

echo "2/3 Cleaning up old containers and starting registry..."
# Remove the specific conflicting container if it exists
docker rm -f fastapi-gateway 2>/dev/null
docker start registry 2>/dev/null || docker run -d -p 5001:5000 --restart=always --name registry registry:2

echo "3/3 Starting FastAPI, MinIO, and Grafana..."
# Use docker-compose with force-recreate to avoid name conflicts
docker-compose up -d --force-recreate

echo "✅ All systems go!"
echo "➡️  FastAPI Gateway: http://localhost:5000"
echo "➡️  OpenFaaS UI:     http://localhost:8080/ui/"
echo "➡️  MinIO Console:   http://localhost:9001"
echo "➡️  Grafana:         http://localhost:3000"
