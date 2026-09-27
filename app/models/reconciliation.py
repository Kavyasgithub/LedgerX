from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class ReconciliationCheck(BaseModel):
    name: str
    passed: bool
    detail: str
    discrepancies: list[dict[str, Any]] = []


class ReconciliationReport(BaseModel):
    ok: bool
    ran_at: datetime
    postings_scanned: int
    checks: list[ReconciliationCheck]
