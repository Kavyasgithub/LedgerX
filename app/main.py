from __future__ import annotations

import uuid

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import accounts, admin, holds, payments, transactions, transfers
from app.errors import LedgerError, error_body

app = FastAPI(title="Ledger", version="1.0.0", description="Double-entry accounting ledger")

# The UI (Vite dev server) calls the API from another origin during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def attach_request_id(request: Request, call_next):
    request.state.request_id = f"req_{uuid.uuid4().hex[:16]}"
    response = await call_next(request)
    response.headers["X-Request-Id"] = request.state.request_id
    return response


@app.exception_handler(LedgerError)
async def handle_ledger_error(request: Request, exc: LedgerError):
    return JSONResponse(
        status_code=exc.status,
        content=jsonable_encoder(error_body(exc, getattr(request.state, "request_id", None))),
    )


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request: Request, exc: RequestValidationError):
    safe_errors = [
        {"loc": list(e.get("loc", [])), "msg": e.get("msg"), "type": e.get("type")}
        for e in exc.errors()
    ]
    return JSONResponse(
        status_code=400,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request failed validation.",
                "details": {"errors": safe_errors},
                "request_id": getattr(request.state, "request_id", None),
            }
        },
    )


@app.exception_handler(Exception)
async def handle_unexpected(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "An unexpected error occurred.",
                "request_id": getattr(request.state, "request_id", None),
            }
        },
    )


for router in (accounts, transfers, transactions, holds, payments, admin):
    app.include_router(router.router)


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}
