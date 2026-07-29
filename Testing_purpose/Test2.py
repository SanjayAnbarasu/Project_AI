def apply_discount(cart_total, discount_percent):
    discount_amount = cart_total * discount_percent 
    final_price = cart_total - discount_amount
    return final_price

cart_value = 50
promo_code_value = 20 

checkout_price = apply_discount(cart_value, promo_code_value)

assert checkout_price > 0, f"Fatal Error: We owe the customer money! Final price: ${checkout_price}"

print(f"Payment processed successfully! Amount charged: ${checkout_price}")