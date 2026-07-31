# 🤖 Project_AI: AI-Inspector

An enterprise-grade, real-time code repair engine and telemetry pipeline. AI-Inspector intercepts terminal crashes in VS Code, securely scrubs sensitive data, feeds context into a high-IQ LLM, and automatically patches broken code on disk while tracking everything in a rich analytics dashboard.

## ✨ Core Features

* **⚡ Real-Time Terminal Interception:** Automatically catches runtime stack traces, `SyntaxError`, `IndentationError`, and logic crashes the moment they happen.
* **🔒 Server-Side & Client-Side PII Scrubbing:** Redacts sensitive information (API keys, passwords, emails) locally before any data ever touches the cloud.
* **🧠 Context-Aware Auto-Healing:** Pulls surrounding source code context to generate precise patches without hallucinating fake variable names.
* **🔁 Infinite Loop Protection:** Built-in duplicate shield tracks retry history to prevent runaway execution loops or repeating the same failed fix.
* **🛡️ Dual Engine Architecture:** Uses Groq Cloud (`llama-3.3-70b-versatile`) for lightning-fast primary reasoning, with automatic fallback to local Ollama models (`qwen2.5-coder`) if offline.
* **📊 React Analytics Dashboard:** Integrated Webview dashboard to track session statistics, fix adoption rates, and error telemetry in real-time.

## 🛠️ Full Tech Stack

* **Extension Client:** VS Code Extension API (TypeScript / Node.js)
* **Frontend (Dashboard):** React, Vite, TailwindCSS
* **Backend Pipeline:** FastAPI, Uvicorn, Python 3.x
* **AI Orchestration:** Groq Cloud API, Ollama (Local)
* **Database & Analytics:** PostgreSQL (Neon Cloud), SQLModel

## 🏗️ System Architecture

1. **Detection:** VS Code Extension monitors the active terminal for crash signatures.
2. **Scrubbing:** Extension scrubs local secrets and extracts exact file line numbers.
3. **Routing:** Payload is sent to the FastAPI backend, which aggregates source code context.
4. **Reasoning:** Groq Cloud analyzes the traceback and source code to generate a strict JSON patch.
5. **Healing:** Extension validates the patch against its history ledger and applies the exact line replacement on disk.
6. **Telemetry:** Data is synced to the Neon Postgres database and visualized in the React dashboard.

## 🚀 Getting Started

Clone the repository to get started:
```bash
git clone [https://github.com/SanjayAnbarasu/Project_AI.git](https://github.com/SanjayAnbarasu/Project_AI.git)
cd Project_AI
```

### 1. Backend Setup (FastAPI)

```bash
cd backend

# Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

Create a `.env` file in the `backend` folder:
```env
GROQ_API_KEY=your_groq_api_key_here
DATABASE_URL=postgresql://user:password@your-neon-db-url
```

Start the FastAPI server:
```bash
uvicorn main:app --reload --port 8000
```

### 2. Frontend Dashboard Setup (React + Vite)

The analytics dashboard runs inside the VS Code Webview. Build it before compiling the extension.

```bash
cd ../frontend

# Install dependencies
npm install

# Build the production bundle for the extension to consume
npm run build
```

### 3. VS Code Extension Setup

Package and install the actual VS Code extension.

```bash
cd ../extension

# Install Node dependencies
npm install

# Install the VS Code Extension compiler globally (if not already installed)
npm install -g @vscode/vsce

# Package the extension into a .vsix file
vsce package
```

**To install the extension:**
1. Open VS Code.
2. Go to the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`).
3. Click the `...` menu at the top right of the Extensions view.
4. Select **Install from VSIX...** and choose the `.vsix` file you just generated.

## 📡 API Endpoints Summary

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/log` | Ingests tracebacks, invokes the AI repair engine, and returns a JSON patch. |
| `GET` | `/logs` | Fetches recent crash logs for telemetry display. |
| `PATCH` | `/logs/{id}/apply` | Marks a generated patch as successfully applied by the user. |
| `GET` | `/admin/metrics` | Computes aggregate telemetry metrics (24h errors, adoption rate). |

---
**Author:** Sanjay Anbarasu
