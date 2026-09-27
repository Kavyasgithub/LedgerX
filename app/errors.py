"""Shared error type + helpers for the uniform error envelope."""
from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


class LedgerError(Exception):
    """A business/domain error that maps to the uniform error envelope."""

    def __init__(
        self,
        code: str,
        message: str,
        status: int = 422,
        details: dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details or {}


def error_body(exc: LedgerError, request_id: str | None = None) -> dict:
    return {
        "error": {
            "code": exc.code,
            "message": exc.message,
            "details": exc.details,
            "request_id": request_id,
        }
    }


def ledger_error_response(request: Request, exc: LedgerError) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    return JSONResponse(status_code=exc.status, content=error_body(exc, request_id))
