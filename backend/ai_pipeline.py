import os
import re
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
MAX_RETRIES = 3  # hard cap so a bad fix can't loop forever

SYSTEM_PROMPT = """
You are an expert automated code-repair engine. Your job is to analyze errors and provide precise fixes for languages like Python, Node.js, and React.

CRITICAL REPAIR RULES:

1. ROOT CAUSE ANALYSIS (READ CAREFULLY):
   - The line where the crash/assert/print happened is usually NOT where the bug is. It's just where the wrong value became visible.
   - Before proposing a fix, trace backward: what produced the value that caused the failure? Follow it through variable assignments and function calls in SOURCE CONTEXT until you find the earliest point where a calculation, conversion, or assumption was actually wrong.
   - Fix the bug AT THAT EARLIEST POINT, inside the function or assignment that computes the bad value — not at the line that merely observed or reported it.
   - WORKED EXAMPLE:
     Crash line: `assert checkout_price > 0` fails because checkout_price is negative.
     WRONG approach: deleting or loosening the assert, or recomputing a value in a comment near the assert.
     RIGHT approach: checkout_price came from `apply_discount(cart_total, discount_percent)`. Inside that function,
     `discount_amount = cart_total * discount_percent` treats discount_percent (e.g. 20) as a raw multiplier instead
     of a percentage. The correct fix is inside apply_discount itself:
     `discount_amount = cart_total * (discount_percent / 100)`.
     The "line" you return must be the line number of THAT statement inside apply_discount, not the assert line.
   - If the true root cause is on a different line than the one that crashed, say so explicitly in "reasoning" and return
     the ROOT CAUSE line number, not the crash line number.

2. HANDLING NameError / ReferenceError / UNDEFINED:
   - NEVER guess or invent function/variable names.
   - Only use variable/function names that appear in the SOURCE CONTEXT provided below.
   - If a variable/function is used but never defined: Provide a safe fallback definition, fix a typo, or rewrite the line to be valid in the target language, using ONLY names that already exist in context.

3. PREVENT INFINITE REPLACEMENT LOOPS:
   - You will be shown PREVIOUS FAILED ATTEMPTS if this is a retry. Do NOT repeat a previous attempt or a close variant of it.
   - If previous attempts all patched the same symptom line, that is a signal you have NOT found the root cause yet — look further back through the call chain in SOURCE CONTEXT.
   - If you cannot find a genuinely different, correct fix, say so honestly in "code" as a comment rather than inventing new variable names.

4. OUTPUT FORMAT:
   - Return STRICTLY a JSON object with keys "line" (integer, the ROOT CAUSE line, not necessarily the crash line), "code" (string, the corrected line(s)), and "reasoning" (string, one sentence: what was actually wrong and why this line is the true cause).
   - DO NOT wrap the output in Markdown blocks (like ```json or ```).

Example Output:
{"line": 2, "code": "discount_amount = cart_total * (discount_percent / 100)", "reasoning": "discount_percent was used as a raw multiplier instead of being converted to a fraction, inside apply_discount where checkout_price is actually computed."}
"""


def parse_and_validate_json(response_text: str):
    """
    Safety Shield: Ensures the AI output is actually valid JSON with the right shape.
    """
    clean_text = response_text.strip()

    if clean_text.startswith("```json"):
        clean_text = clean_text[7:]
    elif clean_text.startswith("```"):
        clean_text = clean_text[3:]
    if clean_text.endswith("```"):
        clean_text = clean_text[:-3]

    try:
        parsed = json.loads(clean_text.strip())
        if "line" in parsed and "code" in parsed:
            return parsed
    except json.JSONDecodeError:
        return None
    return None


def extract_identifiers(code: str):
    """Pull plausible variable/function names out of a snippet of code."""
    return set(re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", code))


PY_KEYWORDS = {
    "def", "return", "if", "else", "elif", "for", "while", "in", "not",
    "and", "or", "True", "False", "None", "import", "from", "as", "print",
    "assert", "class", "try", "except", "finally", "with", "lambda",
}


def validate_no_hallucinated_names(proposed_code: str, source_context: str) -> bool:
    """
    Semantic check: every identifier used in the proposed fix must already
    appear somewhere in the source context (function signature, body, etc.),
    or be a Python builtin/keyword/literal. Catches invented names like
    'price_per_item' that were never defined anywhere in the file.
    """
    allowed = extract_identifiers(source_context) | PY_KEYWORDS
    proposed_names = extract_identifiers(proposed_code)
    # ignore obviously safe tokens: numbers already excluded by regex
    unknown = proposed_names - allowed
    # allow a small amount of slack for helper names the model legitimately
    # needs to introduce (e.g. new local temp var) -- but not many at once
    return len(unknown) <= 1


def build_user_content(error_message: str, stack_trace: str, source_context: str,
                        previous_attempts: list[str] | None = None) -> str:
    parts = [
        f"Error: {error_message}",
        f"\nStack Trace:\n{stack_trace}",
        f"\nSOURCE CONTEXT (only use names that appear here):\n{source_context}",
    ]
    if previous_attempts:
        parts.append(
            "\nPREVIOUS FAILED ATTEMPTS (do not repeat these or close variants):\n"
            + "\n".join(f"- {a}" for a in previous_attempts)
        )
    return "\n".join(parts)


def call_ollama_fallback(error_message: str, stack_trace: str, source_context: str,
                          previous_attempts: list[str] | None = None) -> str:
    """
    BACKUP ENGINE: Runs locally if Groq API fails or internet is down.
    """
    user_content = build_user_content(error_message, stack_trace, source_context, previous_attempts)

    print("Attempting local fallback repair using Ollama...")
    try:
        response = ollama.chat(
            model='qwen2.5-coder:1.5b',
            messages=[
                {'role': 'system', 'content': SYSTEM_PROMPT},
                {'role': 'user', 'content': user_content}
            ],
            options={
                "temperature": 0.0  # Keep Ollama deterministic
            }
        )

        raw_content = response['message']['content'].strip()

        parsed = parse_and_validate_json(raw_content)
        if parsed and validate_no_hallucinated_names(parsed["code"], source_context):
            print("Local Ollama fallback succeeded.")
            return raw_content
        else:
            print("Local Ollama returned invalid JSON or hallucinated names.")
            return ""

    except Exception as e:
        print(f"Local Ollama fallback totally failed: {str(e)}")
        return ""


def call_groq_engine(error_message: str, stack_trace: str, source_context: str,
                      previous_attempts: list[str] | None = None) -> str:
    """
    PRIMARY ENGINE: Fast, high-IQ cloud model.
    """
    if not GROQ_API_KEY or GROQ_API_KEY == "YOUR_GROQ_API_KEY_HERE":
        print("Groq API key is unconfigured.")
        return ""

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }

    user_content = build_user_content(error_message, stack_trace, source_context, previous_attempts)

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
        response = requests.post(GROQ_URL, json=payload, headers=headers, timeout=10)
        if response.status_code == 200:
            result = response.json()
            raw_content = result["choices"][0]["message"]["content"].strip()

            parsed = parse_and_validate_json(raw_content)
            if parsed and validate_no_hallucinated_names(parsed["code"], source_context):
                return raw_content
            else:
                print("Groq returned invalid JSON or hallucinated names.")
                return ""
        else:
            print(f"Groq API Error: {response.status_code} - {response.text}")
            return ""
    except Exception as e:
        print(f"Groq network request failed: {str(e)}")
        return ""


def generate_fix_suggestion(error_message: str, stack_trace: str, source_context: str,
                             previous_attempts: list[str] | None = None) -> str:
    """
    Master Router: Cloud-First, Local-Fallback.

    source_context: the actual function/file snippet around the error --
        NOT optional anymore. Without it the model hallucinates variable names.
    previous_attempts: list of raw "code" strings already tried and rejected,
        so the model (and the retry loop) doesn't repeat itself.
    """
    print("Routing to Primary Engine (Groq Cloud API)...")

    groq_result = call_groq_engine(error_message, stack_trace, source_context, previous_attempts)
    if groq_result:
        return groq_result

    print("Groq failed. Activating Offline Backup (Ollama)...")
    return call_ollama_fallback(error_message, stack_trace, source_context, previous_attempts)


def repair_with_retry_cap(error_message: str, stack_trace: str, source_context: str) -> str | None:
    """
    Drives the extension's retry loop with a hard cap and memory of past attempts,
    instead of calling generate_fix_suggestion blindly in an unbounded loop.
    Returns the final validated fix, or None if it gives up after MAX_RETRIES.
    """
    previous_attempts: list[str] = []

    for attempt in range(1, MAX_RETRIES + 1):
        print(f"--- Repair attempt {attempt}/{MAX_RETRIES} ---")
        result = generate_fix_suggestion(error_message, stack_trace, source_context, previous_attempts)

        if not result:
            continue

        parsed = json.loads(result)
        # This is where the extension would apply the fix and re-run the code.
        # For now we just track it as a failed attempt if the caller decides
        # (after re-running) that it still errors -- the extension should call
        # previous_attempts.append(parsed["code"]) and loop again itself, or
        # use this helper end-to-end if it runs the code too.
        previous_attempts.append(parsed["code"])
        return result  # caller applies it, re-runs, and decides whether to retry

    print(f"Giving up after {MAX_RETRIES} attempts -- flagging for human review instead of looping forever.")
    return None