def apply_discount(cart_total, discount_percent):
    # BUSINESS LOGIC BUG: 
    # It multiplies directly instead of converting the percentage to a decimal (dividing by 100).
    discount_amount = cart_total * discount_percent 
    final_price = cart_total - discount_amount
    return final_price

# Customer is buying a $50 item with a 20% discount
cart_value = 50
promo_code_value = 20 

checkout_price = apply_discount(cart_value, promo_code_value)

# BUSINESS RULE: A customer's checkout price can never be negative.
# Original: assert checkout_price > 0, f"Fatal Error: We owe the customer money! Final price: ${checkout_price}"
# Original: discount_amount = cart_total * (discount_percent / 100)
discount_amount = cart_value * (promo_code_value / 100)

print(f"Payment processed successfully! Amount charged: ${checkout_price}")