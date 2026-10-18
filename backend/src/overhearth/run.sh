#!/bin/sh
# Started by the AWS Lambda Web Adapter. API Gateway sets X-Forwarded-Proto, so trust it.
exec python -m uvicorn overhearth.asgi:app --host 127.0.0.1 --port "${PORT:-8080}" --proxy-headers --forwarded-allow-ips '*'
