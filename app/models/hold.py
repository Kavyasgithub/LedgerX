from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_validator

from app.models.transfer import PostingIn


class HoldCreate(BaseModel):
    account_reference: str
    amount: int  # positive, in minor units (natural units the hold reserves)
    currency: str
    expires_in_seconds: int = 3600
    metadata: dict[str, Any] = {}

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("hold amount must be positive")
        return v

    @field_validator("expires_in_seconds")
    @classmethod
    def expiry_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("expires_in_seconds must be positive")
        return v


class HoldResponse(BaseModel):
    id: str
    account_reference: str
    amount: int
    currency: str
    status: str
    transaction_id: str | None
    expires_at: datetime
    created_at: datetime


class HoldCaptureRequest(BaseModel):
    transaction_type: str = "capture"
    currency: str
    postings: list[PostingIn]
    reference_id: str | None = None
    metadata: dict[str, Any] = {}

    @field_validator("postings")
    @classmethod
    def at_least_two(cls, v: list[PostingIn]) -> list[PostingIn]:
        if len(v) < 2:
            raise ValueError("a capture requires at least two postings")
        return v
