from __future__ import annotations

from typing import Any

from pydantic import BaseModel, field_validator


class RefundRequest(BaseModel):
    # Customer-facing amount to refund, in minor units. Omit for a full refund.
    amount: int | None = None
    reason: str | None = None
    metadata: dict[str, Any] = {}

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v: int | None) -> int | None:
        if v is not None and v <= 0:
            raise ValueError("refund amount must be positive")
        return v
