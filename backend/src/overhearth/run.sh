#!/bin/sh
# Started by the AWS Lambda Web Adapter. Forwarded headers are trusted only from the adapter on
# 127.0.0.1 (uvicorn's default), so the client address is the one API Gateway saw.
exec python -m uvicorn overhearth.asgi:app --host 127.0.0.1 --port "${PORT:-8080}" --proxy-headers
