# Original: def apply_discount(price, discount_percentage)
def apply_discount(price, discount_percentage):
    # Business Logic Flaw: Subtracting the raw percentage number instead of calculating the fraction
    # Original: final_price = price - discount_percentage
    final_price = price - (price * (discount_percentage / 100))
    return final_price

result = apply_discount(200, 20)
assert result == 160.0, f"CRITICAL: Billing logic failed. Expected 160.0, got {result}"



print(f"Final price after applying {20}% discount: {result}")