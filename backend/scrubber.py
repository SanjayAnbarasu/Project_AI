import re

# Comprehensive regex patterns for common sensitive credentials
SCRUB_PATTERNS = {
    "API_Key": r"(?i)(api[-_]?key|secret[-_]?key|auth[-_]?token|password)\s*[:=]\s*['\"]([^'\"]+)['\"]",
    "Bearer_Token": r"(?i)bearer\s+[a-zA-Z0-9_\-\.]+",
    "Email": r"[\w\.-]+@[\w\.-]+\.\w+",
    "Slack_Webhook": r"https://hooks\.slack\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]+",
}

def clean_text(text: str) -> str:
    """
    Scans error logs or stack traces and sanitizes sensitive data.
    """
    if not text:
        return text
    
    sanitized = text
    
    # 1. Clean explicit API keys/passwords assignments
    sanitized = re.sub(SCRUB_PATTERNS["API_Key"], r"\1: [REDACTED_SECRET]", sanitized)
    
    # 2. Clean Bearer tokens
    sanitized = re.sub(SCRUB_PATTERNS["Bearer_Token"], "Bearer [REDACTED_TOKEN]", sanitized)
    
    # 3. Clean email addresses
    sanitized = re.sub(SCRUB_PATTERNS["Email"], "[REDACTED_EMAIL]", sanitized)
    
    # 4. Clean webhooks
    sanitized = re.sub(SCRUB_PATTERNS["Slack_Webhook"], "[REDACTED_URL]", sanitized)
    
    return sanitized