#!/bin/bash
echo "Starting Serverless Architecture..."

echo "1/3 Starting daemons (requires sudo)..."
sudo service docker start
sudo service containerd start
sudo service faasd-provider start
sudo service faasd start

echo "2/3 Starting local Docker registry..."
docker start registry 2>/dev/null || docker run -d -p 5001:5000 --restart=always --name registry registry:2

echo "3/3 Starting FastAPI, MinIO, and Grafana..."
cd ~/serverless-image-processing && docker-compose up -d

echo "✅ All systems go!"
echo "➡️  FastAPI Gateway: http://localhost:5000"
echo "➡️  OpenFaaS UI:     http://localhost:8080/ui/"
echo "➡️  MinIO Console:   http://localhost:9001"
echo "➡️  Grafana:         http://localhost:3000"
