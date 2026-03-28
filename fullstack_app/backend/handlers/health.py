"""
handlers/health.py — GET /health

Lightweight liveness check. API Gateway can route this to a cheap Lambda
or use it for ALB health checks. Returns DB connectivity status.
"""

from __future__ import annotations
from app.db import check_connection
from app.models import HealthResponse


def handle(event: dict, context: object) -> dict:
    db_ok = check_connection()
    body = HealthResponse(
        status="ok" if db_ok else "degraded",
        db_connected=db_ok,
    )
    return {
        "statusCode": 200,
        "body": body.model_dump_json(),
        "headers": {"Content-Type": "application/json"},
    }
