"""Integration tests: full payment lifecycle through the public API."""
import uuid


def ikey() -> dict:
    return {"Idempotency-Key": str(uuid.uuid4())}


async def _topup(client, wallet: str, amount: int):
    return await client.post(
        "/v1/transfers",
        headers=ikey(),
        json={
            "transaction_type": "topup",
            "currency": "INR",
            "postings": [
                {"account_reference": "bank:settlement", "amount": amount},
                {"account_reference": wallet, "amount": -amount},
            ],
        },
    )


async def test_full_lifecycle_topup_capture_refund_reverse(client):
    # top up 500
    assert (await _topup(client, "customer:c1:wallet", 50000)).status_code == 201

    # authorize (hold) 10000, then capture as a payment with fee
    hold = await client.post(
        "/v1/holds",
        headers=ikey(),
        json={"account_reference": "customer:c1:wallet", "amount": 10000, "currency": "INR"},
    )
    assert hold.status_code == 201
    acct = (await client.get("/v1/accounts/customer:c1:wallet")).json()
    assert acct["held_amount"] == 10000
    assert acct["available_balance"] == 40000

    cap = await client.post(
        f"/v1/holds/{hold.json()['id']}/capture",
        headers=ikey(),
        json={
            "currency": "INR",
            "postings": [
                {"account_reference": "customer:c1:wallet", "amount": 10000},
                {"account_reference": "merchant:m1:balance", "amount": -9800},
                {"account_reference": "platform:fee_revenue", "amount": -200},
            ],
        },
    )
    assert cap.status_code == 201, cap.text
    payment_id = cap.json()["transaction_id"]

    acct = (await client.get("/v1/accounts/customer:c1:wallet")).json()
    assert acct["current_balance"] == 40000 and acct["held_amount"] == 0

    # partial refund 4000 -> merchant +3920, fee +80, customer -4000
    refund = await client.post(
        f"/v1/payments/{payment_id}/refund", headers=ikey(), json={"amount": 4000}
    )
    assert refund.status_code == 201, refund.text
    legs = {p["account_reference"]: p["amount"] for p in refund.json()["postings"]}
    assert legs == {
        "merchant:m1:balance": 3920,
        "platform:fee_revenue": 80,
        "customer:c1:wallet": -4000,
    }

    # reverse the refund, balances restored for that leg
    rev = await client.post(
        f"/v1/transactions/{refund.json()['transaction_id']}/reverse", headers=ikey()
    )
    assert rev.status_code == 201, rev.text

    # everything still reconciles
    rec = (await client.post("/v1/admin/reconcile")).json()
    assert rec["ok"] is True, rec


async def test_reverse_twice_is_blocked(client):
    r = await _topup(client, "customer:c2:wallet", 20000)
    tid = r.json()["transaction_id"]
    assert (await client.post(f"/v1/transactions/{tid}/reverse", headers=ikey())).status_code == 201
    second = await client.post(f"/v1/transactions/{tid}/reverse", headers=ikey())
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "ALREADY_REVERSED"


async def test_hold_release_frees_availability(client):
    await _topup(client, "customer:c1:wallet", 50000)
    hold = await client.post(
        "/v1/holds",
        headers=ikey(),
        json={"account_reference": "customer:c1:wallet", "amount": 5000, "currency": "INR"},
    )
    hid = hold.json()["id"]
    assert (await client.get("/v1/accounts/customer:c1:wallet")).json()["held_amount"] == 5000
    rel = await client.post(f"/v1/holds/{hid}/release", headers=ikey())
    assert rel.status_code == 200 and rel.json()["status"] == "released"
    assert (await client.get("/v1/accounts/customer:c1:wallet")).json()["held_amount"] == 0
    # capturing a released hold is rejected
    cap = await client.post(
        f"/v1/holds/{hid}/capture",
        headers=ikey(),
        json={
            "currency": "INR",
            "postings": [
                {"account_reference": "customer:c1:wallet", "amount": 1000},
                {"account_reference": "merchant:m1:balance", "amount": -1000},
            ],
        },
    )
    assert cap.status_code == 422 and cap.json()["error"]["code"] == "HOLD_NOT_ACTIVE"
