import os
import requests
import ollama
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

# ==========================================
# ENTERPRISE AI PIPELINE CONFIGURATION
# ==========================================
# Insert your Groq API key here, or set it in your system environment variables.
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

client = Groq(
    api_key=GROQ_API_KEY
)

def call_groq_fallback(error_message: str, stack_trace: str) -> str:
    """
    Cloud Engine (Llama-3 via Groq): High-IQ code replacement engine.
    Used for complex logical reasoning (like React state) where local models fail.
    """
    if GROQ_API_KEY == "YOUR_GROQ_API_KEY_HERE" or not GROQ_API_KEY:
        return "//\n AI Fix Engine Error :Groq API key is unconfigured. Please add your key to ai_pipeline.py"

    # Set up the request headers and payload for the Groq API(author Sanjay)
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }

    #Working Prompt for groq AI(Author Sanjay)
    system_prompt = """
You are an advanced code-correction API. Analyze the error and the Source Code.

CRITICAL INSTRUCTIONS:
1. Determine the true root cause. If an 'assert', test, or print statement failed, the bug is NOT on that line. The bug is in the function/math that generated the wrong value higher up.
2. Output a strictly valid JSON object with exactly two keys: "line" and "code".
3. "line": The integer line number in the Source Code that actually needs to be replaced (e.g., the line with the bad math).
4. "code": The functional replacement code.
5. DO NOT output the `# Original:` or `// Original:` tag (the client handles this). DO NOT use markdown blocks (```). Output ONLY the raw JSON object.

Example Output:
{"line": 3, "code": "final_price = price - (price * (discount_percentage / 100))"}
"""

    
    user_content = f"Error: {error_message}\n\nStack Trace:\n{stack_trace}"

    payload = {
        # You can upgrade this to "llama3-70b-8192" if you need even more reasoning power
        "model": "openai/gpt-oss-120b", 
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ],
        "temperature": 0.1 #prevent hallucination (Author Sanjay)
    }

    try:
        response = requests.post(GROQ_URL, json=payload, headers=headers, timeout=10)
        if response.status_code == 200:
            result = response.json()
            return result["choices"][0]["message"]["content"].strip()
        else:
            # Print to your backend terminal, but return empty to the frontend so it skips the edit
            print(f"API Error: {response.status_code} - {response.text}")
            return ""
    except Exception as e:
        print(f"Failed to connect: {str(e)}")
        return ""


def generate_fix_suggestion(error_message: str, stack_trace: str) -> str:
    """
    Primary Engine Routing: Determines which AI model handles the crash.
    """
    print("Routing directly to Groq Cloud API for high-IQ processing...")
    
    # For this React Gauntlet test, we skip Ollama and go straight to Groq.
    return call_groq_fallback(error_message, stack_trace)
    
    # -------------------------------------------------------------------------
    # LOCAL OLLAMA PIPELINE (Commented out for the React Gauntlet test)
    # Once you are done testing Groq, you can uncomment this block to 
    # route basic errors to Qwen first, and use Groq only when Ollama fails.
    # -------------------------------------------------------------------------
    
    # system_prompt = "..." # (Use the same strict prompt as above)
    # user_content = f"Error: {error_message}\n\nStack Trace:\n{stack_trace}"
    # 
    # try:
    #     response = ollama.chat(
    #         model='qwen2.5-coder:1.5b',
    #         messages=[
    #             {'role': 'system', 'content': system_prompt},
    #             {'role': 'user', 'content': user_content}
    #         ]
    #     )
    #     return response['message']['content']
    #     
    # except Exception as local_exception:
    #     print(f"Local Ollama failed: {str(local_exception)}. Swapping to Groq fallback pipeline...")
    #     return call_groq_fallback(error_message, stack_trace)