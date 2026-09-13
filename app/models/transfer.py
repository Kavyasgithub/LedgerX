from pydantic import BaseModel, field_validator
from datetime import datetime
from typing import Any


class PostingIn(BaseModel):
    account_reference: str
    amount: int

    @field_validator("amount")
    @classmethod
    def amount_nonzero(cls, v: int) -> int:
        if v == 0:
            raise ValueError("Posting amount must not be zero")
        return v


class TransferRequest(BaseModel):
    transaction_type: str
    reference_id: str | None = None
    currency: str
    postings: list[PostingIn]
    metadata: dict[str, Any] = {}

    @field_validator("postings")
    @classmethod
    def at_least_two_postings(cls, v: list[PostingIn]) -> list[PostingIn]:
        if len(v) < 2:
            raise ValueError("A transaction requires at least two postings")
        return v


class PostingOut(BaseModel):
    id: int
    account_reference: str
    amount: int
    resulting_balance: int


class TransferResponse(BaseModel):
    transaction_id: str
    transaction_type: str
    reference_id: str | None
    currency: str
    created_at: datetime
    postings: list[PostingOut]
