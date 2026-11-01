from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from app.core import calculate_order

app = FastAPI(title="DevMuse Demo Store", version="0.1.0")

class Order(BaseModel):
    item: str
    quantity: int = Field(ge=1, le=100)
    discount_percent: int = 0

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/catalog")
def catalog():
    return {"items": ["book", "mouse", "keyboard"]}

@app.post("/orders/quote")
def quote(order: Order):
    try:
        return calculate_order(order.item, order.quantity, order.discount_percent)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

from fastapi.responses import FileResponse
from pathlib import Path
@app.get("/")
def home():
    return FileResponse(Path(__file__).resolve().parent.parent / "web" / "index.html")
