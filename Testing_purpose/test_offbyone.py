def get_last_n_items(items, n):
    # BUG: should return the LAST n items, but this slices wrong
    return items[0:n]

inventory = ["apple", "banana", "cherry", "date", "elderberry"]
last_two = get_last_n_items(inventory, 2)

assert last_two == ["date", "elderberry"], f"Fatal Error: Expected last 2 items, got {last_two}"
print(f"Success! Last 2 items: {last_two}")
