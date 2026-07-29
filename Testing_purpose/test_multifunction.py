def celsius_to_fahrenheit(celsius):
    # BUG: wrong formula, should be (celsius * 9/5) + 32
    return celsius + 32

def get_weather_report(city, celsius_temp):
    fahrenheit_temp = celsius_to_fahrenheit(celsius_temp)
    return f"{city}: {fahrenheit_temp}F"

def print_forecast(city, celsius_temp):
    report = get_weather_report(city, celsius_temp)
    print(report)
    return report

result = print_forecast("Chennai", 30)  # 30C should be 86F, not 62F

assert "86" in result, f"Fatal Error: Expected 86F for 30C, got: {result}"
print("Temperature conversion correct!")
