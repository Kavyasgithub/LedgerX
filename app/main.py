from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api import accounts, transfers

app = FastAPI(title="Ledger", version="1.0.0")

app.include_router(accounts.router)
app.include_router(transfers.router)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "An unexpected error occurred.",
            }
        },
    )


@app.get("/health")
def health():
    return {"status": "ok"}
