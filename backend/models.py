from typing import Optional
from datetime import datetime, timezone
from sqlmodel import Field, SQLModel

class SystemLog(SQLModel, table=True):
    __tablename__: str = "system_logs"

    id: Optional[int] = Field(default=None, primary_key=True)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    
    # Error Context
    error_message: str
    stack_trace: str
    file_path: str
    line_number: int
    repository: str
    organization: Optional[str] = None
    #(Added one more field to track the developer name who is applying the fix(Author Sanjay))
    developer_name: Optional[str] = Field(default="Unknown Developer")
    
    # AI & Status Tracking
    ai_suggestion: Optional[str] = None
    fix_applied: bool = Field(default=False)
    tag: Optional[str] = Field(default="manual_highlight")#to check the manual highlight like its auto or manual applied fix or not 