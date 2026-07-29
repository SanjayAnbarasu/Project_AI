def is_eligible_for_discount(age, membership_years):
    # BUG: should require BOTH conditions, but uses OR instead of AND
    return age >= 65 or membership_years >= 10

customer_age = 70
customer_membership_years = 2
eligible = is_eligible_for_discount(customer_age, customer_membership_years)

# This customer is 70 (meets age) but only a 2-year member (fails tenure).
# With OR, this incorrectly returns True. Correct logic (AND) should return False
# only if BOTH conditions must hold -- adjust expectation to match your actual policy.
assert eligible == False, f"Fatal Error: age={customer_age} alone should not qualify under AND-based policy, but got {eligible}"
print(f"Correct! Eligibility check passed: {eligible}")
