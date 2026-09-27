from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, field_validator


class AccountCreate(BaseModel):
    reference: str
    account_type: str
    currency: str
    allows_negative: bool | None = None
    normal_side: str | None = None  # 'debit' | 'credit'; derived from type if omitted

    @field_validator("currency")
    @classmethod
    def currency_format(cls, v: str) -> str:
        if not (len(v) == 3 and v.isalpha() and v.isupper()):
            raise ValueError("currency must be a 3-letter uppercase ISO code")
        return v

    @field_validator("normal_side")
    @classmethod
    def normal_side_valid(cls, v: str | None) -> str | None:
        if v is not None and v not in ("debit", "credit"):
            raise ValueError("normal_side must be 'debit' or 'credit'")
        return v


class AccountResponse(BaseModel):
    id: str
    reference: str
    account_type: str
    currency: str
    normal_side: str
    allows_negative: bool
    current_balance: int   # natural balance (human-facing, sign-flipped as needed)
    held_amount: int
    available_balance: int
    created_at: datetime
