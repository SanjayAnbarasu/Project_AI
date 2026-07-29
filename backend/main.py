from fastapi import FastAPI, Depends, HTTPException
from sqlmodel import Session
from database import init_db, get_session
from models import SystemLog
from pydantic import BaseModel
from typing import Optional
from sqlmodel import select, func
# imported to handle Ai genration from ai_pipline file fro easier access im marking here
from ai_pipeline import generate_fix_suggestion
from scrubber import clean_text
from datetime import datetime, timedelta, timezone #initially used timedelta later after reserch of depreciation timezone is used to get the current time in UTC format
from fastapi.middleware.cors import CORSMiddleware
import jwt
from fastapi import FastAPI, HTTPException, Depends, status
from pydantic import BaseModel
import re
import os
from dotenv import load_dotenv


#initialize the app
app = FastAPI(title="AI Log Analytics Backend Pipeline", version="1.0.3")

# --- SECURITY CONFIGURATION ---
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256" #alternatively you can use "RS256" for asymmetric encryption, but it requires key management.

#login page credentials (Hardcoded)
class LoginRequest(BaseModel):
    username: str
    password: str

# 1. The Bouncer (Token Verification Dependency)
def verify_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    
def redact_pii(text: str) -> str:
    """
    Scans incoming terminal logs and rips out sensitive data before it hits the LLM.
    """
    if not text:
        return text

    # 1. Email Addresses
    email_pattern = r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+'
    text = re.sub(email_pattern, '[REDACTED_EMAIL]', text)

    # 2. IP Addresses (IPv4)
    ip_pattern = r'\b(?:\d{1,3}\.){3}\d{1,3}\b'
    text = re.sub(ip_pattern, '[REDACTED_IP]', text)

    # 3. Standard API Keys & Secrets 
    # Note: We look for keywords like 'key', 'token', 'secret', or 'password' nearby
    secret_pattern = r'(?i)(api[_-]?key|secret|token|password)[\s:=]+[\'"]?([a-zA-Z0-9\-_\.]{15,})[\'"]?'
    # This keeps the keyword (password) but replaces the actual secret
    text = re.sub(secret_pattern, r'\1: [REDACTED_SECRET]', text)

    # 4. Phone Numbers 
    phone_pattern = r'\+?\d{1,3}?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}'
    text = re.sub(phone_pattern, '[REDACTED_PHONE]', text)

    return text

# 2. The Key Generator (Login Endpoint)
@app.post("/token")
async def login(credentials: LoginRequest):
    if credentials.username == "admin" and credentials.password == "securepassword123":
        expire = datetime.now(timezone.utc) + timedelta(hours=1)
        token = jwt.encode({"sub": credentials.username, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)
        return {"access_token": token, "token_type": "bearer"}
    
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect username or password",
    )


@app.get("/admin/error-trends")
def get_error_trends(session: Session = Depends(get_session)):

    BUSINESS_TZ_OFFSET = timedelta(hours=5, minutes=30)  # IST
    business_tz = timezone(BUSINESS_TZ_OFFSET)

    def to_aware_utc(dt: datetime) -> datetime:
        return dt.astimezone(timezone.utc)

    trends = []
    now_local = datetime.now(business_tz)
    today_local_midnight = now_local.replace(hour=0, minute=0, second=0, microsecond=0)

    for hour in range(10, 20):  # 10:00 through 19:00 local -> 10AM-7PM
        slot_start_today = today_local_midnight.replace(hour=hour)
        slot_end_today = slot_start_today + timedelta(hours=1)
        slot_start_prev_day = slot_start_today - timedelta(days=1)
        slot_end_prev_day = slot_start_prev_day + timedelta(hours=1)

        today_count = session.exec(
            select(func.count(SystemLog.id))
            .where(SystemLog.timestamp >= to_aware_utc(slot_start_today))
            .where(SystemLog.timestamp < to_aware_utc(slot_end_today))
        ).one()

        previous_day_count = session.exec(
            select(func.count(SystemLog.id))
            .where(SystemLog.timestamp >= to_aware_utc(slot_start_prev_day))
            .where(SystemLog.timestamp < to_aware_utc(slot_end_prev_day))
        ).one()

        trends.append({
            "time": slot_start_today.strftime("%H:00"),
            "errors": today_count,
            "previousErrors": previous_day_count,
        })

    return trends

# Configure CORS Middleware so our React application can securely read endpoints
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- LIFECYCLE EVENT ---
# Triggers automatically the moment the FastAPI server boots up.
# This ensures all necessary SQLite database tables are created 
# and ready to store data before the server accepts any API requests.
@app.on_event("startup")
def on_startup():
    init_db()

# Request Validation Schema matching the API contract
#this is  used to store the logs from the frontend and store it in the database
class LogIngestionPayload(BaseModel):
    error_message: str
    stack_trace: str
    file_path: str
    line_number: int
    repository: str
    organization: Optional[str] = None
    tag: Optional[str] = "manual"
    #(Added one more field to track the developer name who is applying the fix(Author Sanjay))
    developer_name: Optional[str] = "Unknown Developer"
    # Real surrounding source code around the crash line, sent by the extension
    # so the model can't invent variable/function names that don't exist.
    source_context: Optional[str] = ""
    # Prior failed fix attempts for this file, so the model doesn't repeat
    # itself on retries instead of converging on a correct fix.
    previous_attempts: Optional[list[str]] = None


# initial state of backend without endpoint connections
@app.get("/")
def read_root():
    return {"status": "Backend pipeline operational"}


#this is used for log ingestion endpoint to ingest the logs from the frontend and store it in the database
@app.post("/log", response_model=SystemLog)
def ingest_log(payload: LogIngestionPayload, session: Session = Depends(get_session)):
    try:
        # 1. Run server-side PII scrubbing safety net
        scrubbed_message = redact_pii(payload.error_message)
        scrubbed_stack = redact_pii(payload.stack_trace)
        # Source context can also contain secrets (hardcoded keys, etc in the
        # file itself), so it goes through the same scrubbing pass.
        scrubbed_context = redact_pii(payload.source_context or "")

        # 2. Fire the AI pipeline generation step using our scrubbed data.
        # source_context grounds the model in real variable/function names so
        # it stops hallucinating ones that don't exist in the file.
        # previous_attempts stops it from repeating the same wrong fix on retries.
        ai_fix = generate_fix_suggestion(
            scrubbed_message,
            scrubbed_stack,
            scrubbed_context,
            payload.previous_attempts,
        )
        
        # 3. Persist the entry cleanly to SQLite
        new_log = SystemLog(
            error_message=scrubbed_message,
            stack_trace=scrubbed_stack,
            file_path=payload.file_path,
            line_number=payload.line_number,
            repository=payload.repository,
            organization=payload.organization,
            ai_suggestion=ai_fix if ai_fix else None,
            tag=payload.tag,
            #(Added one more field to track the developer name who is applying the fix(Author Sanjay))
            developer_name=payload.developer_name
        )
        #used for database purpose to add the new log entry to the database and commit the changes
        session.add(new_log)#session will be added
        session.commit()#session will be committed
        session.refresh(new_log)#session will be refreshed to get the latest state of the new_log object
        
        return new_log
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database ingestion failed: {str(e)}")   

    # Response Schema for Dashboard Metadata / Overview Metrics
class DashboardMetrics(BaseModel):
    total_errors_24h: int
    fix_adoption_rate: float
    total_logs_ingested: int
    total_fixes_applied: int

@app.get("/admin/metrics", response_model=DashboardMetrics)
def get_dashboard_metrics(session: Session = Depends(get_session)):
    """
    Computes aggregate telemetry metrics for the System Overview cards.
    """
    # 1. Total logs ingested (all-time)
    total_logs = session.exec(select(func.count(SystemLog.id))).one()

    # 2. Total errors in the last 24 hours specifically (was incorrectly using the all-time total)
    last_24h_cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    total_errors_24h = session.exec(
        select(func.count(SystemLog.id)).where(SystemLog.timestamp >= last_24h_cutoff)
    ).one()

    # 3. Total fixes applied
    total_fixes = session.exec(select(func.count(SystemLog.id)).where(SystemLog.fix_applied == True)).one()
    
    # 4. Calculate fix adoption percentage safely
    adoption_rate = (total_fixes / total_logs * 100) if total_logs > 0 else 0.0
    
    #give data to the frontend for dashboard metrics
    return DashboardMetrics(
        total_errors_24h=total_errors_24h,
        fix_adoption_rate=round(adoption_rate, 1),
        total_logs_ingested=total_logs,
        total_fixes_applied=total_fixes
    )

#(currently disabled) Endpoint to fetch the most frequent error-causing files for the Leaderboard widget(Author Sanjay)
# @app.get("/admin/hot-files")
# def get_hot_files(session: Session = Depends(get_session), limit: int = 5):
#     """
#     Returns the most frequent error-causing files for the Leaderboard widget.
#     """
#     # Group by file_path and count occurrences
#     statement = (
#         select(SystemLog.file_path, func.count(SystemLog.id).label("error_count"))
#         .group_by(SystemLog.file_path)#group errors based on file path
#         .order_by(func.count(SystemLog.id).asc())#order the errors based on the count of errors
#         .limit(limit)#limit the number of results to the specified limit (default is 5)
#     )
#     results = session.exec(statement).all()
    
#     # Format cleanly for frontend ingestion
#     return [{"file_path": row[0], "error_count": row[1]} for row in results]

@app.get("/logs")
def get_recent_logs(session: Session = Depends(get_session)):
    """
    give the most recent logs in our dashboard view,i've set 500 
    """
    statement = select(SystemLog).order_by(SystemLog.id.desc()).limit(500)
    logs = session.exec(statement).all()
    return logs

# Endpoint to mark a log entry as having its fix applied
@app.patch("/logs/{log_id}/apply")
async def mark_fix_applied(log_id: int, new_tag: Optional[str] = None, db: Session = Depends(get_session)):    # Standard SQLAlchemy/SQLModel update logic
    log_entry = db.query(SystemLog).filter(SystemLog.id == log_id).first()
    
    if log_entry:
        log_entry.fix_applied = True

        #manual addition of tag (Manual fixed)   
        if new_tag:
            log_entry.tag = new_tag

        db.commit()
        return {"status": "success", "message": f"Log {log_id} marked as fixed."}
    
    return {"status": "error", "message": "Log not found"}, 404