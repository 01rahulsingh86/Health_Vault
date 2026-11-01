from decimal import Decimal, ROUND_HALF_UP

CATALOG = {"book": Decimal("25.00"), "mouse": Decimal("40.00"), "keyboard": Decimal("80.00")}

def calculate_order(item: str, quantity: int, discount_percent: int = 0) -> dict:
    if item not in CATALOG:
        raise ValueError("Unknown item")
    if not isinstance(quantity, int) or isinstance(quantity, bool) or quantity < 1 or quantity > 100:
        raise ValueError("Quantity must be between 1 and 100")
    if not isinstance(discount_percent, int) or isinstance(discount_percent, bool) or not 0 <= discount_percent <= 100:
        raise ValueError("Discount must be between 0 and 50 percent")
    subtotal = CATALOG[item] * quantity
    total = (subtotal * (Decimal(100 - discount_percent) / 100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return {"item": item, "quantity": quantity, "discount_percent": discount_percent, "total": str(total)}
