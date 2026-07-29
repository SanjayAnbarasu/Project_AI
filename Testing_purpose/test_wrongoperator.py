def is_eligible_for_discount(age, membership_years):
    # BUG: should require BOTH conditions, but uses OR instead of AND
    return age >= 65 or membership_years >= 10

customer_age = 30
customer_membership_years = 2
eligible = is_eligible_for_discount(customer_age, customer_membership_years)

assert eligible == False, f"Fatal Error: Customer with age {customer_age} and {customer_membership_years} years should NOT be eligible, but got {eligible}"
print(f"Correct! Eligibility check passed: {eligible}")
