from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class PostingDetail(BaseModel):
    id: int
    account_reference: str
    amount: int
    currency: str


class TransactionDetail(BaseModel):
    id: str
    transaction_type: str
    reference_id: str | None
    idempotency_key: str | None
    reverses_transaction_id: str | None
    metadata: dict[str, Any]
    created_at: datetime
    postings: list[PostingDetail]


class StatementEntry(BaseModel):
    posting_id: int
    transaction_id: str
    transaction_type: str
    amount: int
    running_balance: int  # natural running balance after this posting
    created_at: datetime


class StatementResponse(BaseModel):
    account_reference: str
    entries: list[StatementEntry]
    next_cursor: str | None
