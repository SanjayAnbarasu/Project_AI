import * as vscode from 'vscode';
import { exec } from 'child_process';
import { WebviewDashboardProvider } from './UserInterface/WebviewDashboardProvider';

// ======================================================
// 1. STATE & CIRCUIT BREAKER CONFIGURATION
// ======================================================

let retryCount = 0;
let isAutonomous = true;

const retryTracker = new Map<string, number>();
const MAX_RETRIES = 3;

// Tracks last error signature per file to prevent duplicate loops
const lastErrorPerFile = new Map<string, string>();

// Interface definitions
interface LogResponse {
    status: string;
    id: number;
    ai_suggestion?: string;
}

interface ActivityEntry {
    time: string;
    message: string;
}

interface FixRecord {
    id: number;
    filePath: string;
    lineNumber: number;
    timestamp: string;
    mode: 'auto' | 'manual';
    applied: boolean;
    suggestion: string;
}

// In-memory persistent history store for chat/dashboard integration
const fixHistory: FixRecord[] = [];

// ======================================================
// 2. SECURITY & PRIVACY LAYER
// ======================================================

const LOCAL_SCRUB_PATTERNS = {
    apiKey: /(api[-_]?key|secret[-_]?key|auth[-_]?token|password)\s*[:=]\s*['"]([^'"]+)['"]/gi,
    email: /[\w\.-]+@[\w\.-]+\.\w+/g
};

function localScrub(text: string): string {
    let cleaned = text;
    cleaned = cleaned.replace(LOCAL_SCRUB_PATTERNS.apiKey, '$1: [REDACTED_LOCAL_SECRET]');
    cleaned = cleaned.replace(LOCAL_SCRUB_PATTERNS.email, '[REDACTED_LOCAL_EMAIL]');
    return cleaned;
}

// ======================================================
// 3. AI INSPECTOR STATES & ACTIVITY MANAGER
// ======================================================

enum InspectorState {
    Idle,
    Monitoring,
    CrashDetected,
    Sending,
    WaitingAI,
    ApplyingFix,
    Rerunning,
    BackendOffline,
    ManualMode
}

const MAX_ACTIVITY = 15;
const activityLog: ActivityEntry[] = [];

function getCurrentTime(): string {
    return new Date().toLocaleTimeString();
}

function logActivity(message: string) {
    activityLog.unshift({
        time: getCurrentTime(),
        message
    });

    if (activityLog.length > MAX_ACTIVITY) {
        activityLog.pop();
    }

    console.log(`[AI Inspector] ${getCurrentTime()} | ${message}`);
}

function getActivityLog(): ActivityEntry[] {
    return activityLog;
}

function recordFixData(record: FixRecord) {
    fixHistory.unshift(record);
    if (fixHistory.length > 50) {
        fixHistory.pop();
    }
}

// ======================================================
// 4. DASHBOARD & STATUS BAR STATS MANAGER
// ======================================================

let inspectorStatusBar: vscode.StatusBarItem;
let dashboard: WebviewDashboardProvider;
let currentState: InspectorState = InspectorState.Idle;

let errorsDetected = 0;
let autoFixes = 0;
let manualFixes = 0;
let reruns = 0;
let lastAIResponseTime = 0;
let successRate = 100;

const sessionStart = Date.now();

function updateInspectorStatus(state: InspectorState, extra?: string) {
    console.log("AI Inspector State:", InspectorState[state]);
    currentState = state;

    if (!inspectorStatusBar) {
        return;
    }

    let statusText = "";
    let dashboardStatus = "";

    switch (state) {
        case InspectorState.Idle:
            statusText = "$(circle-outline) AI Inspector";
            dashboardStatus = "⚪ Idle";
            break;
        case InspectorState.Monitoring:
            statusText = "$(pulse) AI Inspector • Monitoring";
            dashboardStatus = "❤️‍🔥  Monitoring";
            break;
        case InspectorState.CrashDetected:
            statusText = "$(warning) AI Inspector • Crash";
            dashboardStatus = "🔴 Crash Detected";
            break;
        case InspectorState.Sending:
            statusText = "$(cloud-upload) AI Inspector • Sending";
            dashboardStatus = "☁️ Sending Logs";
            break;
        case InspectorState.WaitingAI:
            statusText = "$(sync~spin) AI Inspector • AI Thinking";
            dashboardStatus = "🤖 AI Processing";
            break;
        case InspectorState.ApplyingFix:
            statusText = "$(tools) AI Inspector • Applying Fix";
            dashboardStatus = "🛠 Applying Fix";
            break;
        case InspectorState.Rerunning:
            statusText = "$(play) AI Inspector • Re-running";
            dashboardStatus = "▶ Re-running";
            break;
        case InspectorState.BackendOffline:
            statusText = "$(error) AI Inspector • Offline";
            dashboardStatus = "🔴 Backend Offline";
            break;
        case InspectorState.ManualMode:
            statusText = "$(person) AI Inspector • Manual";
            dashboardStatus = "👤 Manual Mode";
            break;
    }

    successRate = errorsDetected === 0
        ? 100
        : Math.round(((autoFixes + manualFixes) / errorsDetected) * 100);

    if (dashboard) {
        const minutes = Math.floor((Date.now() - sessionStart) / 60000);

        dashboard.setStats({
            errorsDetected,
            errorsFixed: autoFixes,
            manualFixes,
            reruns,
            successRate: `${successRate}%`,
            sessionTime: `${minutes} min`,
            aiResponse: `${lastAIResponseTime} ms`
        });

        dashboard.setStatus(dashboardStatus);
        dashboard.setMode(isAutonomous ? "Autonomous" : "Manual");
        dashboard.setActivities(getActivityLog().map(a => `${a.time}  ${a.message}`));

        const activeEditor = vscode.window.activeTextEditor;
        dashboard.setCurrentFile(
            activeEditor
                ? activeEditor.document.fileName.split(/[\\/]/).pop() || "Unknown"
                : "None"
        );
    }

    inspectorStatusBar.text = statusText;

    switch (state) {
        case InspectorState.Monitoring:
            logActivity("Monitoring terminal");
            break;
        case InspectorState.CrashDetected:
            errorsDetected++;
            logActivity("Crash detected");
            break;
        case InspectorState.Sending:
            logActivity("Sending logs to AI backend");
            break;
        case InspectorState.WaitingAI:
            logActivity("Waiting for AI response");
            break;
        case InspectorState.ApplyingFix:
            autoFixes++;
            logActivity("Applying AI patch");
            break;
        case InspectorState.Rerunning:
            reruns++;
            logActivity("Re-running application");
            break;
        case InspectorState.BackendOffline:
            logActivity("Backend unavailable");
            break;
        case InspectorState.ManualMode:
            logActivity("Switched to manual mode");
            break;
    }
}

// ======================================================
// 5. AGENT INITIALIZATION & LIFECYCLE MANAGEMENT
// ======================================================

export function activate(context: vscode.ExtensionContext) {
    console.log('Ai-Inspector layer initialized.');

    // 1. Webview Dashboard Initialization
    dashboard = new WebviewDashboardProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            WebviewDashboardProvider.viewType,
            dashboard
        )
    );

    // 2. Status Bar Initialization
    inspectorStatusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    inspectorStatusBar.command = "aiInspector.showActivity";
    inspectorStatusBar.show();
    updateInspectorStatus(InspectorState.Monitoring);
    context.subscriptions.push(inspectorStatusBar);

    let terminalBuffer = "";
    let debounceTimer: NodeJS.Timeout | null = null;

    // ======================================================
    // COMMAND REGISTRATION LAYER (Easy Identification)
    // ======================================================

    // Command: Show Activity QuickPick
    context.subscriptions.push(
        vscode.commands.registerCommand("aiInspector.showActivity", () => {
            const items = getActivityLog().map(activity => ({
                label: activity.message,
                description: activity.time
            }));

            vscode.window.showQuickPick(items, {
                title: "AI Inspector Activity History"
            });
        })
    );

    // Command: Manual Error Highlight Send
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-inspector.sendError', async () => {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                return;
            }

            const selectionText = activeEditor.document.getText(activeEditor.selection);
            if (!selectionText) {
                vscode.window.showWarningMessage("Ai-Inspector: Please highlight the terminal error text first.");
                return;
            }

            const secureText = localScrub(selectionText);
            const selectionLine = activeEditor.selection.active.line + 1;

            await sendLogToBackend(secureText, activeEditor.document.fileName, selectionLine, "manual_highlight");
            vscode.window.showInformationMessage("Ai-Inspector: Manual error forwarded to analytics pipeline!");
        })
    );

    // Command: Toggle Autonomous / Manual Mode
    context.subscriptions.push(
        vscode.commands.registerCommand("aiInspector.toggleMode", () => {
            isAutonomous = !isAutonomous;
            const modeName = isAutonomous ? "Autonomous" : "Manual";
            logActivity(`Mode changed to ${modeName}`);
            if (dashboard) {
                dashboard.setMode(modeName);
            }
            vscode.window.showInformationMessage(`Ai-Inspector: Mode switched to ${modeName}`);
        })
    );

    // Command: Clear Activity Log
    context.subscriptions.push(
        vscode.commands.registerCommand("aiInspector.clearActivity", () => {
            activityLog.length = 0;
            logActivity("Activity log cleared");
            if (dashboard) {
                dashboard.setActivities([]);
            }
            vscode.window.showInformationMessage("Ai-Inspector: Activity log cleared.");
        })
    );

    // Command: Reset Session Statistics
    context.subscriptions.push(
        vscode.commands.registerCommand("aiInspector.resetStats", () => {
            errorsDetected = 0;
            autoFixes = 0;
            manualFixes = 0;
            reruns = 0;
            updateInspectorStatus(currentState);
            vscode.window.showInformationMessage("Ai-Inspector: Session statistics reset.");
        })
    );

    // Command: Open / Focus Dashboard
    context.subscriptions.push(
        vscode.commands.registerCommand("aiInspector.openDashboard", () => {
            vscode.commands.executeCommand("aiInspectorDashboard.focus");
        })
    );

    // ======================================================
    // AUTONOMOUS BACKGROUND OBSERVER
    // ======================================================
    const terminalListener = (vscode.window as any).onDidWriteTerminalData?.((event: { data: string }) => {
        terminalBuffer += event.data;

        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
            analyzeTerminalStream(terminalBuffer);
            terminalBuffer = "";
        }, 1500);
    });

    if (terminalListener) {
        context.subscriptions.push(terminalListener);
    }

    // Backend Health Checker (Every 5 Seconds)
    setInterval(() => {
        checkBackendHealth();
    }, 5000);

    checkBackendHealth();
}

async function checkBackendHealth() {
    try {
        const response = await fetch("http://127.0.0.1:8000/docs", { method: "GET" });
        if (response.ok) {
            dashboard?.setBackendStatus("🟢 Online");
        } else {
            dashboard?.setBackendStatus("🔴 Offline");
        }
    } catch {
        dashboard?.setBackendStatus("🔴 Offline");
    }
}

export function deactivate() { }

// ======================================================
// 6. REAL-TIME SIGNATURE & ANOMALY DETECTION
// ======================================================

async function analyzeTerminalStream(rawText: string) {
    updateInspectorStatus(InspectorState.Monitoring);

    const cleanText = rawText.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

    const isShellError = cleanText.includes("CommandNotFoundException") ||
        cleanText.includes("ItemNotFoundException") ||
        cleanText.includes("is not recognized as the name of a cmdlet");

    const errorSignatures = [
        "Traceback (most recent call last):",
        "TypeError",
        "ValueError",
        "Exception",
        "npm ERR!",
        "ZeroDivisionError",
        "error:",
        "ReferenceError",
        "SyntaxError",
        "RangeError",
        "NameError",
        "IndentationError",
        "Error: Cannot find module",
        "Error:"
    ];

    const crashDetected = !isShellError && errorSignatures.some(signature => cleanText.includes(signature));

    if (crashDetected) {
        updateInspectorStatus(InspectorState.CrashDetected, "Runtime Error Detected");
        vscode.window.showErrorMessage("Ai-Inspector: Crash anomaly detected in active terminal! Forwarding...");

        let determinedPath = "Active Terminal Stream";
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            determinedPath = activeEditor.document.fileName;
        } else {
            const fileMatch = cleanText.match(/([\w\d\.\-]+\.(?:py|js|cpp|rb|html))/i);
            if (fileMatch) {
                determinedPath = fileMatch[1];
            }
        }

        const genericFallbackMatch = cleanText.match(/line\s+(\d+)|:(\d+)(?::\d+)?/i);
        const fallbackLine = genericFallbackMatch
            ? parseInt(genericFallbackMatch[1] || genericFallbackMatch[2], 10)
            : 1;

        const encryptedLogs = localScrub(cleanText);
        await sendLogToBackend(encryptedLogs, determinedPath, fallbackLine, "auto_detected");
    }
}

function extractLineForFile(text: string, filePath: string): number | null {
    const fileName = (filePath.split(/[/\\]/).pop() || filePath).trim();
    if (!fileName) {
        return null;
    }

    const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const jsStyle = new RegExp(`${escaped}:(\\d+)(?::(\\d+))?`, 'g');
    const pyStyle = new RegExp(`${escaped}["']?,\\s*line\\s+(\\d+)`, 'gi');

    const jsMatches = [...text.matchAll(jsStyle)];
    const pyMatches = [...text.matchAll(pyStyle)];

    if (filePath.endsWith('.py')) {
        if (pyMatches.length > 0) {
            return parseInt(pyMatches[pyMatches.length - 1][1], 10);
        }
        if (jsMatches.length > 0) {
            return parseInt(jsMatches[jsMatches.length - 1][1], 10);
        }
        return null;
    }

    if (jsMatches.length > 0) {
        return parseInt(jsMatches[0][1], 10);
    }
    if (pyMatches.length > 0) {
        return parseInt(pyMatches[0][1], 10);
    }
    return null;
}

// ======================================================
// 7. NETWORK PAYLOAD LAYER & UI INTEGRATION
// ======================================================

async function sendLogToBackend(scrubbedText: string, locationPath: string, lineFallback: number, deliveryTag: string) {
    try {
        const structuralLines = scrubbedText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const primaryMessage = structuralLines.length > 0 ? structuralLines[structuralLines.length - 1] : "Runtime Exception";
        const fileScopedLine = extractLineForFile(scrubbedText, locationPath);
        const crashedLineNumber = fileScopedLine ?? lineFallback;
        const activeDeveloper = await getDeveloperIdentity();

        const errorSignatureKey = `${locationPath}::${primaryMessage}`;
        const previousSignatureKey = lastErrorPerFile.get(locationPath);
        lastErrorPerFile.set(locationPath, errorSignatureKey);

        const payload = {
            error_message: primaryMessage.substring(0, 250),
            stack_trace: scrubbedText,
            file_path: locationPath,
            line_number: crashedLineNumber,
            repository: vscode.workspace.name || "CP_Chat_App",
            organization: "personal",
            tag: deliveryTag,
            developer_name: activeDeveloper
        };

        const startTime = Date.now();
        updateInspectorStatus(InspectorState.Sending);

        const response = await fetch('http://127.0.0.1:8000/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        lastAIResponseTime = Date.now() - startTime;
        const responseData = (await response.json()) as LogResponse;
        updateInspectorStatus(InspectorState.WaitingAI);

        if (responseData.ai_suggestion) {
            const currentRetries = retryTracker.get(locationPath) || 0;
            const isAutoMode = (deliveryTag === "auto_detected" && locationPath !== "Active Terminal Stream");

            let effectiveRetries = currentRetries;

            // --- BRANCH A: AUTONOMOUS AUTOMATION LOOP ---
            if (isAutonomous && isAutoMode && effectiveRetries < MAX_RETRIES) {
                vscode.window.showInformationMessage(`🤖 Auto-Healing initiated for ${locationPath} (Attempt ${effectiveRetries + 1}/${MAX_RETRIES})...`);
                updateInspectorStatus(InspectorState.ApplyingFix);

                // FIXED: Explicitly pass locationPath so it edits the target file, not whichever tab is open
                const applied = await applyFixToFile(responseData.ai_suggestion, crashedLineNumber, locationPath);

                if (applied) {
                    await markLogAsFixed(responseData.id);
                    retryTracker.set(locationPath, effectiveRetries + 1);

                    recordFixData({
                        id: responseData.id,
                        filePath: locationPath,
                        lineNumber: crashedLineNumber,
                        timestamp: getCurrentTime(),
                        mode: 'auto',
                        applied: true,
                        suggestion: responseData.ai_suggestion
                    });

                    // Ghost Typist: Auto-rerun script
                    const terminal = vscode.window.activeTerminal || vscode.window.createTerminal("Ai-Inspector Execution Agent");
                    if (terminal) {
                        vscode.window.showInformationMessage(`🚀 Auto-rerunning script...`);
                        const commandPrefix = locationPath.endsWith('.py') ? 'python' : 'node';
                        terminal.show();
                        updateInspectorStatus(InspectorState.Rerunning);
                        terminal.sendText(`${commandPrefix} "${locationPath}"`);
                        updateInspectorStatus(InspectorState.Monitoring);
                    }
                    return;
                } else {
                    vscode.window.showWarningMessage(`🚨 AI suggested a duplicate fix. Aborting loop to prevent runaway behavior.`);
                    effectiveRetries = MAX_RETRIES;
                    retryTracker.set(locationPath, MAX_RETRIES);
                }
            }

            // --- BRANCH B: MANUAL FALLBACK ---
            if (!isAutonomous || !isAutoMode || effectiveRetries >= MAX_RETRIES) {
                if (isAutonomous && effectiveRetries >= MAX_RETRIES) {
                    vscode.window.showWarningMessage(`🚨 Auto-Heal limit reached or loop detected. Switching to Manual Mode.`);
                }

                const userAction = await vscode.window.showInformationMessage(
                    `Ai-Inspector found a fix on Line ${crashedLineNumber}! Apply inline?`,
                    "Apply Fix"
                );

                if (userAction === "Apply Fix") {
                    // FIXED: Explicitly pass locationPath to prevent off-target edits
                    const applied = await applyFixToFile(responseData.ai_suggestion, crashedLineNumber, locationPath);

                    if (applied) {
                        manualFixes++;
                        await markLogAsFixed(responseData.id, "manual_highlight");

                        recordFixData({
                            id: responseData.id,
                            filePath: locationPath,
                            lineNumber: crashedLineNumber,
                            timestamp: getCurrentTime(),
                            mode: 'manual',
                            applied: true,
                            suggestion: responseData.ai_suggestion
                        });

                        retryTracker.set(locationPath, 0);
                        lastErrorPerFile.delete(locationPath);
                        retryCount = 0;

                        if (isAutonomous) {
                            const terminal = vscode.window.activeTerminal;
                            if (terminal) {
                                vscode.window.showInformationMessage(`🚀 Manual fix applied. Auto-rerunning script...`);
                                const commandPrefix = locationPath.endsWith('.py') ? 'python' : 'node';
                                terminal.show();
                                terminal.sendText(`${commandPrefix} "${locationPath}"`);
                            }
                        }
                    }
                } else {
                    retryTracker.set(locationPath, 0);
                    lastErrorPerFile.delete(locationPath);
                }
            }
        }
    } catch (error: any) {
        updateInspectorStatus(InspectorState.BackendOffline);
        console.error("Telemetry Pipeline Gateway Offline:", error.message);
    }
}

// ======================================================
// 8. EXPLICIT FILE TARGET INLINE CODE REPLACEMENT
// ======================================================

async function applyFixToFile(suggestionText: string, lineNumber: number, targetFilePath: string): Promise<boolean> {
    if (!targetFilePath || targetFilePath === "Active Terminal Stream") {
        vscode.window.showErrorMessage("Ai-Inspector: Cannot apply fix without a valid target file path!");
        return false;
    }

    try {
        // Explicit Target Document Resolution (prevents active tab switching bugs)
        const targetUri = vscode.Uri.file(targetFilePath);
        const document = await vscode.workspace.openTextDocument(targetUri);

        const edit = new vscode.WorkspaceEdit();
        const langId = document.languageId;

        let commentPrefix = "//";
        if (langId === "python" || langId === "ruby" || langId === "shellscript") {
            commentPrefix = "#";
        } else if (langId === "html") {
            commentPrefix = "<!--";
        }

        const zeroIndexedLine = Math.max(0, Math.min(lineNumber - 1, document.lineCount - 1));
        const brokenLine = document.lineAt(zeroIndexedLine);

        let cleanSuggestion = suggestionText
            .replace(/```[a-zA-Z]*\r?\n?/g, '')
            .replace(/```/g, '')
            .trim();

        if (cleanSuggestion.startsWith('{') && cleanSuggestion.endsWith('}')) {
            try {
                const parsedJson = JSON.parse(cleanSuggestion);
                if (parsedJson.code) {
                    cleanSuggestion = parsedJson.code;
                } else if (parsedJson.ai_suggestion) {
                    cleanSuggestion = parsedJson.ai_suggestion;
                }
                if (parsedJson.line) {
                    lineNumber = parsedJson.line;
                }
            } catch (jsonError) {
                // Fallback to plain string if parsing fails
            }
        }

        cleanSuggestion = cleanSuggestion.trim();
        const previousLineIndex = Math.max(0, zeroIndexedLine - 1);
        const previousLineText = document.lineAt(previousLineIndex).text.trim();
        const brokenLineTrimmed = brokenLine.text.trim();
        const suggestionFirstLine = cleanSuggestion.split('\n')[0].trim();

        const alreadyApplied =
            brokenLineTrimmed === suggestionFirstLine ||
            previousLineText === suggestionFirstLine;

        if (alreadyApplied) {
            updateInspectorStatus(InspectorState.ManualMode);
            vscode.window.showWarningMessage("Ai-Inspector: Suggested fix already present at this location — skipping duplicate patch.");
            return false;
        }

        const firstNonSpace = brokenLine.firstNonWhitespaceCharacterIndex;
        const originalIndentation = firstNonSpace === -1 ? "" : brokenLine.text.substring(0, firstNonSpace);

        let replacementBlock = `${originalIndentation}${commentPrefix} Original: ${brokenLine.text.trim()}`;
        if (langId === "html") {
            replacementBlock += " -->\n";
        } else {
            replacementBlock += "\n";
        }

        const indentedFix = cleanSuggestion.split('\n').map(line => `${originalIndentation}${line}`).join('\n');
        replacementBlock += indentedFix;

        edit.replace(document.uri, brokenLine.range, replacementBlock);
        const success = await vscode.workspace.applyEdit(edit);

        if (success) {
            await document.save();
        }

        return success;
    } catch (error) {
        console.error("Ai-Inspector Target File Error:", error);
        vscode.window.showErrorMessage(`Ai-Inspector: Could not target file ${targetFilePath}`);
        return false;
    }
}

// ======================================================
// 9. UTILITY & HELPER FUNCTIONS
// ======================================================

function getDeveloperIdentity(): Promise<string> {
    return new Promise((resolve) => {
        exec('git config user.name', (error, stdout) => {
            if (error || !stdout.trim()) {
                resolve("Sanjay Anbarasu");
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

async function markLogAsFixed(logId: number, updatedTag?: string) {
    if (!logId) {
        return;
    }

    try {
        let url = `http://127.0.0.1:8000/logs/${logId}/apply`;
        if (updatedTag) {
            url += `?new_tag=${updatedTag}`;
        }

        await fetch(url, { method: 'PATCH' });
    } catch (err) {
        console.error("Could not update fix status on backend dashboard:", err);
    }
}