import os
import json
import requests
import ollama
from dotenv import load_dotenv

load_dotenv()

# ==========================================
# ENTERPRISE AI PIPELINE CONFIGURATION
# ==========================================
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

SYSTEM_PROMPT = """
You are an expert automated code-repair engine. Your job is to analyze errors and provide precise fixes for languages like Python, Node.js, and React.

CRITICAL REPAIR RULES:
1. ROOT CAUSE & SYNTAX ANALYSIS:
   - If the error is an IndentationError or SyntaxError, target the exact line reported.
   - If fixing an IndentationError, append a comment (e.g., `print(c) # Fixed indent`) so the editor registers a distinct code change.
   - If the error is a logical crash (AssertionError, ZeroDivisionError), fix the calculation/logic.
2. VARIABLE CONSISTENCY:
   - Use ONLY the variable and function names defined in the provided Source Code Context. Never invent new variables.
3. PREVENT REPEAT LOOPS:
   - Check the 'Previous Failed Attempts' list if provided. DO NOT output any fix listed in previous attempts.

OUTPUT FORMAT:
- Return STRICTLY a JSON object with exactly two keys: "line" (integer) and "code" (string).
- "line": The integer line number in the Source Code that needs replacement.
- "code": The replacement line of code.
- DO NOT wrap output in Markdown code blocks (like ```json).

Example Output:
{"line": 5, "code": "print(c) # Fixed indent"}
"""

def parse_and_validate_json(response_text: str):
    """Safety Shield: Ensures the AI output is valid JSON with required keys."""
    clean_text = response_text.strip()
    
    if clean_text.startswith("```json"):
        clean_text = clean_text[7:]
    elif clean_text.startswith("```"):
        clean_text = clean_text[3:]
    if clean_text.endswith("```"):
        clean_text = clean_text[:-3]
        
    try:
        parsed = json.loads(clean_text.strip())
        if isinstance(parsed, dict) and "line" in parsed and "code" in parsed:
            return parsed
    except json.JSONDecodeError:
        return None
    return None

def call_ollama_fallback(error_message: str, stack_trace: str, source_context: str = "", previous_attempts: list = None) -> str:
    """BACKUP ENGINE: Local Ollama model (used when running locally if Groq fails)."""
    user_content = f"Error: {error_message}\n\nStack Trace:\n{stack_trace}\n\nSource Code Context:\n{source_context}\n\nPrevious Attempts:\n{previous_attempts}"
    
    try:
        response = ollama.chat(
            model='qwen2.5-coder:1.5b',
            messages=[
                {'role': 'system', 'content': SYSTEM_PROMPT},
                {'role': 'user', 'content': user_content}
            ],
            options={"temperature": 0.0}
        )
        raw_content = response['message']['content'].strip()
        if parse_and_validate_json(raw_content):
            return raw_content
    except Exception as e:
        print(f"Local Ollama fallback unavailable or failed: {str(e)}")
    return ""

def call_groq_engine(error_message: str, stack_trace: str, source_context: str = "", previous_attempts: list = None) -> str:
    """PRIMARY ENGINE: High-IQ Groq Cloud Model."""
    if not GROQ_API_KEY or GROQ_API_KEY == "YOUR_GROQ_API_KEY_HERE":
        print("Groq API key is unconfigured.")
        return ""

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    
    user_content = f"""
Error Message:
{error_message}

Stack Trace:
{stack_trace}

Source Code Context:
{source_context}

Previous Failed Attempts:
{previous_attempts if previous_attempts else "None"}
"""
    
    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content}
        ],
        "temperature": 0.0,
        "response_format": {"type": "json_object"}
    }

    try:
        response = requests.post(GROQ_URL, json=payload, headers=headers, timeout=15)
        if response.status_code == 200:
            result = response.json()
            raw_content = result["choices"][0]["message"]["content"].strip()
            if parse_and_validate_json(raw_content):
                return raw_content
            else:
                print(f"Groq returned invalid JSON: {raw_content}")
                return ""
        else:
            print(f"Groq API Error Status {response.status_code}: {response.text}")
            return ""
    except Exception as e:
        print(f"Groq API request exception: {str(e)}")
        return ""

def generate_fix_suggestion(
    error_message: str, 
    stack_trace: str, 
    source_context: str = "", 
    previous_attempts: list = None
) -> str:
    """Master Router: Accepts all 4 parameters sent by main.py."""
    print("Routing error request to Groq Cloud API...")
    
    groq_result = call_groq_engine(error_message, stack_trace, source_context, previous_attempts)
    if groq_result:
        return groq_result
        
    print("Groq Cloud engine failed/timed out. Trying local fallback...")
    return call_ollama_fallback(error_message, stack_trace, source_context, previous_attempts)