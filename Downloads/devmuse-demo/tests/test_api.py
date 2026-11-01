import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health():
    assert client.get("/health").json() == {"status": "ok"}

def test_quote():
    response = client.post("/orders/quote", json={"item":"mouse", "quantity":2, "discount_percent":25})
    assert response.status_code == 200
    assert response.json()["total"] == "60.00"

def test_invalid_item():
    response = client.post("/orders/quote", json={"item":"nothing", "quantity":1})
    assert response.status_code == 400
