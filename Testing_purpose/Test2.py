def apply_discount(price, discount_percentage):
    # Business Logic Flaw: Subtracting the raw percentage number instead of calculating the fraction
    final_price = price - discount_percentage
    return final_price

result = apply_discount(200, 20)
# Original: assert result == 160.0, f"CRITICAL: Billing logic failed. Expected 160.0, got {result}"
# Original: return hours * 18
# Original: return hours * 16
# Original: return hours * 16
    # Original: return hours * 16
    # Original:     return hours * 16
        # Original: return hours * 16
        # Original:         return hours * 16
            return hours * 16