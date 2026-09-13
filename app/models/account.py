from pydantic import BaseModel
from datetime import datetime


class AccountCreate(BaseModel):
    reference: str
    account_type: str
    currency: str
    allows_negative: bool = False


class AccountResponse(BaseModel):
    id: str
    reference: str
    account_type: str
    currency: str
    allows_negative: bool
    current_balance: int
    held_amount: int
    available_balance: int
    created_at: datetime
