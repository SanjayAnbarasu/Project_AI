"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode2 = __toESM(require("vscode"));
var import_child_process = require("child_process");
var os = __toESM(require("os"));

// src/UserInterface/WebviewDashboardProvider.ts
var vscode = __toESM(require("vscode"));
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var WebviewDashboardProvider = class {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
  }
  extensionUri;
  static viewType = "aiInspectorDashboard";
  _view;
  state = {
    status: "Initializing...",
    backendStatus: "Unknown",
    mode: "Autonomous",
    currentFile: "None",
    activity: [],
    stats: {
      errorsDetected: 0,
      errorsFixed: 0,
      manualFixes: 0,
      reruns: 0,
      sessionTime: "0 min",
      successRate: "0",
      aiResponse: "0 ms"
    }
  };
  resolveWebviewView(webviewView, _context, _token) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(
          this.extensionUri,
          "src",
          "UserInterface",
          "Media"
        )
      ]
    };
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    this.postState();
  }
  // ====================================================
  // Public Update Methods
  // ====================================================
  setStatus(status) {
    this.state.status = status;
    this.postState();
  }
  setBackendStatus(status) {
    this.state.backendStatus = status;
    this.postState();
  }
  setMode(mode) {
    this.state.mode = mode;
    this.postState();
  }
  setCurrentFile(file) {
    this.state.currentFile = file;
    this.postState();
  }
  setActivities(activity) {
    this.state.activity = activity;
    this.postState();
  }
  setStats(stats) {
    this.state.stats = {
      ...this.state.stats,
      ...stats
    };
    this.postState();
  }
  // ====================================================
  // Send State
  // ====================================================
  postState() {
    if (!this._view) {
      return;
    }
    this._view.webview.postMessage({
      type: "dashboardState",
      state: this.state
    });
  }
  // ====================================================
  // HTML Loader
  // ====================================================
  getHtmlForWebview(webview) {
    const htmlPath = path.join(
      this.extensionUri.fsPath,
      "src",
      "UserInterface",
      "Media",
      "Dashboard.html"
    );
    let html = fs.readFileSync(htmlPath, "utf8");
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "src",
        "UserInterface",
        "Media",
        "Dashboard.css"
      )
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "src",
        "UserInterface",
        "Media",
        "Dashboard.js"
      )
    );
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "src",
        "UserInterface",
        "Media",
        "tennis-badge.png"
      )
    );
    const nonce = getNonce();
    html = html.replace(/\$\{styleUri\}/g, styleUri.toString()).replace(/\$\{scriptUri\}/g, scriptUri.toString()).replace(/\$\{logoUri\}/g, logoUri.toString()).replace(/\$\{nonce\}/g, nonce).replace(/\$\{webview\.cspSource\}/g, webview.cspSource);
    return html;
  }
};
function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(
      Math.floor(Math.random() * possible.length)
    );
  }
  return text;
}

// src/extension.ts
var retryCount = 0;
var isAutonomous = true;
var retryTracker = /* @__PURE__ */ new Map();
var MAX_RETRIES = 3;
var lastErrorPerFile = /* @__PURE__ */ new Map();
var fixHistory = [];
var LOCAL_SCRUB_PATTERNS = {
  apiKey: /(api[-_]?key|secret[-_]?key|auth[-_]?token|password)\s*[:=]\s*['"]([^'"]+)['"]/gi,
  email: /[\w\.-]+@[\w\.-]+\.\w+/g
};
function localScrub(text) {
  let cleaned = text;
  cleaned = cleaned.replace(LOCAL_SCRUB_PATTERNS.apiKey, "$1: [REDACTED_LOCAL_SECRET]");
  cleaned = cleaned.replace(LOCAL_SCRUB_PATTERNS.email, "[REDACTED_LOCAL_EMAIL]");
  return cleaned;
}
var InspectorState = /* @__PURE__ */ ((InspectorState2) => {
  InspectorState2[InspectorState2["Idle"] = 0] = "Idle";
  InspectorState2[InspectorState2["Monitoring"] = 1] = "Monitoring";
  InspectorState2[InspectorState2["CrashDetected"] = 2] = "CrashDetected";
  InspectorState2[InspectorState2["Sending"] = 3] = "Sending";
  InspectorState2[InspectorState2["WaitingAI"] = 4] = "WaitingAI";
  InspectorState2[InspectorState2["ApplyingFix"] = 5] = "ApplyingFix";
  InspectorState2[InspectorState2["Rerunning"] = 6] = "Rerunning";
  InspectorState2[InspectorState2["BackendOffline"] = 7] = "BackendOffline";
  InspectorState2[InspectorState2["ManualMode"] = 8] = "ManualMode";
  return InspectorState2;
})(InspectorState || {});
var MAX_ACTIVITY = 15;
var activityLog = [];
function getCurrentTime() {
  return (/* @__PURE__ */ new Date()).toLocaleTimeString();
}
function logActivity(message) {
  activityLog.unshift({
    time: getCurrentTime(),
    message
  });
  if (activityLog.length > MAX_ACTIVITY) {
    activityLog.pop();
  }
  console.log(`[AI Inspector] ${getCurrentTime()} | ${message}`);
}
function getActivityLog() {
  return activityLog;
}
function recordFixData(record) {
  fixHistory.unshift(record);
  if (fixHistory.length > 50) {
    fixHistory.pop();
  }
}
var inspectorStatusBar;
var dashboard;
var currentState = 0 /* Idle */;
var errorsDetected = 0;
var autoFixes = 0;
var manualFixes = 0;
var reruns = 0;
var lastAIResponseTime = 0;
var successRate = 100;
var sessionStart = Date.now();
function updateInspectorStatus(state, extra) {
  console.log("AI Inspector State:", InspectorState[state]);
  currentState = state;
  if (!inspectorStatusBar) {
    return;
  }
  let statusText = "";
  let dashboardStatus = "";
  switch (state) {
    case 0 /* Idle */:
      statusText = "$(circle-outline) AI Inspector";
      dashboardStatus = "\u26AA Idle";
      break;
    case 1 /* Monitoring */:
      statusText = "$(pulse) AI Inspector \u2022 Monitoring";
      dashboardStatus = "\u2764\uFE0F\u200D\u{1F525}  Monitoring";
      break;
    case 2 /* CrashDetected */:
      statusText = "$(warning) AI Inspector \u2022 Crash";
      dashboardStatus = "\u{1F534} Crash Detected";
      break;
    case 3 /* Sending */:
      statusText = "$(cloud-upload) AI Inspector \u2022 Sending";
      dashboardStatus = "\u2601\uFE0F Sending Logs";
      break;
    case 4 /* WaitingAI */:
      statusText = "$(sync~spin) AI Inspector \u2022 AI Thinking";
      dashboardStatus = "\u{1F916} AI Processing";
      break;
    case 5 /* ApplyingFix */:
      statusText = "$(tools) AI Inspector \u2022 Applying Fix";
      dashboardStatus = "\u{1F6E0} Applying Fix";
      break;
    case 6 /* Rerunning */:
      statusText = "$(play) AI Inspector \u2022 Re-running";
      dashboardStatus = "\u25B6 Re-running";
      break;
    case 7 /* BackendOffline */:
      statusText = "$(error) AI Inspector \u2022 Offline";
      dashboardStatus = "\u{1F534} Backend Offline";
      break;
    case 8 /* ManualMode */:
      statusText = "$(person) AI Inspector \u2022 Manual";
      dashboardStatus = "\u{1F464} Manual Mode";
      break;
  }
  successRate = errorsDetected === 0 ? 100 : Math.round((autoFixes + manualFixes) / errorsDetected * 100);
  if (dashboard) {
    const minutes = Math.floor((Date.now() - sessionStart) / 6e4);
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
    dashboard.setActivities(getActivityLog().map((a) => `${a.time}  ${a.message}`));
    const activeEditor = vscode2.window.activeTextEditor;
    dashboard.setCurrentFile(
      activeEditor ? activeEditor.document.fileName.split(/[\\/]/).pop() || "Unknown" : "None"
    );
  }
  inspectorStatusBar.text = statusText;
  switch (state) {
    case 1 /* Monitoring */:
      logActivity("Monitoring terminal");
      break;
    case 2 /* CrashDetected */:
      errorsDetected++;
      logActivity("Crash detected");
      break;
    case 3 /* Sending */:
      logActivity("Sending logs to AI backend");
      break;
    case 4 /* WaitingAI */:
      logActivity("Waiting for AI response");
      break;
    case 5 /* ApplyingFix */:
      autoFixes++;
      logActivity("Applying AI patch");
      break;
    case 6 /* Rerunning */:
      reruns++;
      logActivity("Re-running application");
      break;
    case 7 /* BackendOffline */:
      logActivity("Backend unavailable");
      break;
    case 8 /* ManualMode */:
      logActivity("Switched to manual mode");
      break;
  }
}
function activate(context) {
  console.log("Ai-Inspector layer initialized.");
  dashboard = new WebviewDashboardProvider(context.extensionUri);
  context.subscriptions.push(
    vscode2.window.registerWebviewViewProvider(
      WebviewDashboardProvider.viewType,
      dashboard
    )
  );
  inspectorStatusBar = vscode2.window.createStatusBarItem(
    vscode2.StatusBarAlignment.Left,
    100
  );
  inspectorStatusBar.command = "aiInspector.showActivity";
  inspectorStatusBar.show();
  updateInspectorStatus(1 /* Monitoring */);
  context.subscriptions.push(inspectorStatusBar);
  let terminalBuffer = "";
  let debounceTimer = null;
  context.subscriptions.push(
    vscode2.commands.registerCommand("aiInspector.showActivity", () => {
      const items = getActivityLog().map((activity) => ({
        label: activity.message,
        description: activity.time
      }));
      vscode2.window.showQuickPick(items, {
        title: "AI Inspector Activity History"
      });
    })
  );
  context.subscriptions.push(
    vscode2.commands.registerCommand("ai-inspector.sendError", async () => {
      const activeEditor = vscode2.window.activeTextEditor;
      if (!activeEditor) {
        return;
      }
      const selectionText = activeEditor.document.getText(activeEditor.selection);
      if (!selectionText) {
        vscode2.window.showWarningMessage("Ai-Inspector: Please highlight the terminal error text first.");
        return;
      }
      const secureText = localScrub(selectionText);
      const selectionLine = activeEditor.selection.active.line + 1;
      await sendLogToBackend(secureText, activeEditor.document.fileName, selectionLine, "manual_highlight");
      vscode2.window.showInformationMessage("Ai-Inspector: Manual error forwarded to analytics pipeline!");
    })
  );
  context.subscriptions.push(
    vscode2.commands.registerCommand("aiInspector.toggleMode", () => {
      isAutonomous = !isAutonomous;
      const modeName = isAutonomous ? "Autonomous" : "Manual";
      logActivity(`Mode changed to ${modeName}`);
      if (dashboard) {
        dashboard.setMode(modeName);
      }
      vscode2.window.showInformationMessage(`Ai-Inspector: Mode switched to ${modeName}`);
    })
  );
  context.subscriptions.push(
    vscode2.commands.registerCommand("aiInspector.clearActivity", () => {
      activityLog.length = 0;
      logActivity("Activity log cleared");
      if (dashboard) {
        dashboard.setActivities([]);
      }
      vscode2.window.showInformationMessage("Ai-Inspector: Activity log cleared.");
    })
  );
  context.subscriptions.push(
    vscode2.commands.registerCommand("aiInspector.resetStats", () => {
      errorsDetected = 0;
      autoFixes = 0;
      manualFixes = 0;
      reruns = 0;
      updateInspectorStatus(currentState);
      vscode2.window.showInformationMessage("Ai-Inspector: Session statistics reset.");
    })
  );
  context.subscriptions.push(
    vscode2.commands.registerCommand("aiInspector.openDashboard", () => {
      vscode2.commands.executeCommand("aiInspectorDashboard.focus");
    })
  );
  const terminalListener = vscode2.window.onDidWriteTerminalData?.((event) => {
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
  setInterval(() => {
    checkBackendHealth();
  }, 5e3);
  checkBackendHealth();
}
async function checkBackendHealth() {
  try {
    const response = await fetch("https://project-ai-75sc.onrender.com/docs", { method: "GET" });
    if (response.ok) {
      dashboard?.setBackendStatus("\u{1F7E2} Online");
    } else {
      dashboard?.setBackendStatus("\u{1F534} Offline");
    }
  } catch {
    dashboard?.setBackendStatus("\u{1F534} Offline");
  }
}
function deactivate() {
}
async function analyzeTerminalStream(rawText) {
  updateInspectorStatus(1 /* Monitoring */);
  const cleanText = rawText.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
  const isShellError = cleanText.includes("CommandNotFoundException") || cleanText.includes("ItemNotFoundException") || cleanText.includes("is not recognized as the name of a cmdlet");
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
  const crashDetected = !isShellError && errorSignatures.some((signature) => cleanText.includes(signature));
  if (crashDetected) {
    updateInspectorStatus(2 /* CrashDetected */, "Runtime Error Detected");
    vscode2.window.showErrorMessage("Ai-Inspector: Crash anomaly detected in active terminal! Forwarding...");
    let determinedPath = "Active Terminal Stream";
    const activeEditor = vscode2.window.activeTextEditor;
    if (activeEditor) {
      determinedPath = activeEditor.document.fileName;
    } else {
      const fileMatch = cleanText.match(/([\w\d\.\-]+\.(?:py|js|cpp|rb|html))/i);
      if (fileMatch) {
        determinedPath = fileMatch[1];
      }
    }
    const genericFallbackMatch = cleanText.match(/line\s+(\d+)|:(\d+)(?::\d+)?/i);
    const fallbackLine = genericFallbackMatch ? parseInt(genericFallbackMatch[1] || genericFallbackMatch[2], 10) : 1;
    const encryptedLogs = localScrub(cleanText);
    await sendLogToBackend(encryptedLogs, determinedPath, fallbackLine, "auto_detected");
  }
}
function extractLineForFile(text, filePath) {
  const fileName = (filePath.split(/[/\\]/).pop() || filePath).trim();
  if (!fileName) {
    return null;
  }
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const jsStyle = new RegExp(`${escaped}:(\\d+)(?::(\\d+))?`, "g");
  const pyStyle = new RegExp(`${escaped}["']?,\\s*line\\s+(\\d+)`, "gi");
  const jsMatches = [...text.matchAll(jsStyle)];
  const pyMatches = [...text.matchAll(pyStyle)];
  if (filePath.endsWith(".py")) {
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
async function getSourceContext(filePath, lineNumber, windowSize = 15) {
  try {
    const uri = vscode2.Uri.file(filePath);
    const document = await vscode2.workspace.openTextDocument(uri);
    const zeroIndexed = Math.max(0, lineNumber - 1);
    const start = Math.max(0, zeroIndexed - windowSize);
    const end = Math.min(document.lineCount - 1, zeroIndexed + windowSize);
    const lines = [];
    for (let i = start; i <= end; i++) {
      const marker = i === zeroIndexed ? ">>" : "  ";
      lines.push(`${marker} ${i + 1}: ${document.lineAt(i).text}`);
    }
    return lines.join("\n");
  } catch (err) {
    console.error("Ai-Inspector: could not read source context:", err);
    return "";
  }
}
async function sendLogToBackend(scrubbedText, locationPath, lineFallback, deliveryTag) {
  try {
    const structuralLines = scrubbedText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    const primaryMessage = structuralLines.length > 0 ? structuralLines[structuralLines.length - 1] : "Runtime Exception";
    const fileScopedLine = extractLineForFile(scrubbedText, locationPath);
    const crashedLineNumber = fileScopedLine ?? lineFallback;
    const activeDeveloper = await getDeveloperIdentity();
    const errorSignatureKey = `${locationPath}::${primaryMessage}`;
    const previousSignatureKey = lastErrorPerFile.get(locationPath);
    lastErrorPerFile.set(locationPath, errorSignatureKey);
    const sourceContext = locationPath !== "Active Terminal Stream" ? localScrub(await getSourceContext(locationPath, crashedLineNumber)) : "";
    const priorAttempts = fixHistory.filter((r) => r.filePath === locationPath).slice(0, MAX_RETRIES).map((r) => r.suggestion);
    const payload = {
      error_message: primaryMessage.substring(0, 250),
      stack_trace: scrubbedText,
      source_context: sourceContext,
      previous_attempts: priorAttempts,
      file_path: locationPath,
      line_number: crashedLineNumber,
      repository: vscode2.workspace.name || "CP_Chat_App",
      organization: "personal",
      tag: deliveryTag,
      developer_name: activeDeveloper
    };
    const startTime = Date.now();
    updateInspectorStatus(3 /* Sending */);
    const response = await fetch("https://project-ai-75sc.onrender.com/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    lastAIResponseTime = Date.now() - startTime;
    const responseData = await response.json();
    updateInspectorStatus(4 /* WaitingAI */);
    if (responseData.ai_suggestion) {
      const currentRetries = retryTracker.get(locationPath) || 0;
      const isAutoMode = deliveryTag === "auto_detected" && locationPath !== "Active Terminal Stream";
      let effectiveRetries = currentRetries;
      if (isAutonomous && isAutoMode && effectiveRetries < MAX_RETRIES) {
        vscode2.window.showInformationMessage(`\u{1F916} Auto-Healing initiated for ${locationPath} (Attempt ${effectiveRetries + 1}/${MAX_RETRIES})...`);
        updateInspectorStatus(5 /* ApplyingFix */);
        const applied = await applyFixToFile(responseData.ai_suggestion, crashedLineNumber, locationPath);
        if (applied) {
          await markLogAsFixed(responseData.id);
          retryTracker.set(locationPath, effectiveRetries + 1);
          recordFixData({
            id: responseData.id,
            filePath: locationPath,
            lineNumber: crashedLineNumber,
            timestamp: getCurrentTime(),
            mode: "auto",
            applied: true,
            suggestion: responseData.ai_suggestion
          });
          const terminal = vscode2.window.activeTerminal || vscode2.window.createTerminal("Ai-Inspector Execution Agent");
          if (terminal) {
            vscode2.window.showInformationMessage(`\u{1F680} Auto-rerunning script...`);
            const commandPrefix = locationPath.endsWith(".py") ? "python" : "node";
            terminal.show();
            updateInspectorStatus(6 /* Rerunning */);
            terminal.sendText(`${commandPrefix} "${locationPath}"`);
            updateInspectorStatus(1 /* Monitoring */);
          }
          return;
        } else {
          vscode2.window.showWarningMessage(`\u{1F6A8} AI suggested a duplicate fix. Aborting loop to prevent runaway behavior.`);
          effectiveRetries = MAX_RETRIES;
          retryTracker.set(locationPath, MAX_RETRIES);
        }
      }
      if (!isAutonomous || !isAutoMode || effectiveRetries >= MAX_RETRIES) {
        if (isAutonomous && effectiveRetries >= MAX_RETRIES) {
          vscode2.window.showWarningMessage(`\u{1F6A8} Auto-Heal limit reached or loop detected. Switching to Manual Mode.`);
        }
        const userAction = await vscode2.window.showInformationMessage(
          `Ai-Inspector found a fix on Line ${crashedLineNumber}! Apply inline?`,
          "Apply Fix"
        );
        if (userAction === "Apply Fix") {
          const applied = await applyFixToFile(responseData.ai_suggestion, crashedLineNumber, locationPath);
          if (applied) {
            manualFixes++;
            await markLogAsFixed(responseData.id, "manual_highlight");
            recordFixData({
              id: responseData.id,
              filePath: locationPath,
              lineNumber: crashedLineNumber,
              timestamp: getCurrentTime(),
              mode: "manual",
              applied: true,
              suggestion: responseData.ai_suggestion
            });
            retryTracker.set(locationPath, 0);
            lastErrorPerFile.delete(locationPath);
            retryCount = 0;
            if (isAutonomous) {
              const terminal = vscode2.window.activeTerminal;
              if (terminal) {
                vscode2.window.showInformationMessage(`\u{1F680} Manual fix applied. Auto-rerunning script...`);
                const commandPrefix = locationPath.endsWith(".py") ? "python" : "node";
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
  } catch (error) {
    updateInspectorStatus(7 /* BackendOffline */);
    console.error("Telemetry Pipeline Gateway Offline:", error.message);
  }
}
async function applyFixToFile(suggestionText, lineNumber, targetFilePath) {
  if (!targetFilePath || targetFilePath === "Active Terminal Stream") {
    vscode2.window.showErrorMessage("Ai-Inspector: Cannot apply fix without a valid target file path!");
    return false;
  }
  try {
    const targetUri = vscode2.Uri.file(targetFilePath);
    const document = await vscode2.workspace.openTextDocument(targetUri);
    const edit = new vscode2.WorkspaceEdit();
    const langId = document.languageId;
    let commentPrefix = "//";
    if (langId === "python" || langId === "ruby" || langId === "shellscript") {
      commentPrefix = "#";
    } else if (langId === "html") {
      commentPrefix = "<!--";
    }
    const zeroIndexedLine = Math.max(0, Math.min(lineNumber - 1, document.lineCount - 1));
    const brokenLine = document.lineAt(zeroIndexedLine);
    let cleanSuggestion = suggestionText.replace(/```[a-zA-Z]*\r?\n?/g, "").replace(/```/g, "").trim();
    if (cleanSuggestion.startsWith("{") && cleanSuggestion.endsWith("}")) {
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
      }
    }
    cleanSuggestion = cleanSuggestion.trim();
    const previousLineIndex = Math.max(0, zeroIndexedLine - 1);
    const previousLineText = document.lineAt(previousLineIndex).text.trim();
    const brokenLineTrimmed = brokenLine.text.trim();
    const suggestionFirstLine = cleanSuggestion.split("\n")[0].trim();
    const alreadyApplied = brokenLineTrimmed === suggestionFirstLine || previousLineText === suggestionFirstLine;
    const normalize = (s) => s.replace(/\s+/g, "").toLowerCase();
    const alreadyTriedVariant = fixHistory.filter((r) => r.filePath === targetFilePath).some((r) => {
      try {
        const prior = JSON.parse(r.suggestion);
        return normalize(prior.code || "") === normalize(cleanSuggestion);
      } catch {
        return normalize(r.suggestion) === normalize(cleanSuggestion);
      }
    });
    if (alreadyApplied || alreadyTriedVariant) {
      updateInspectorStatus(8 /* ManualMode */);
      vscode2.window.showWarningMessage("Ai-Inspector: Suggested fix already present or already tried at this location \u2014 skipping duplicate patch.");
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
    const indentedFix = cleanSuggestion.split("\n").map((line) => `${originalIndentation}${line}`).join("\n");
    replacementBlock += indentedFix;
    edit.replace(document.uri, brokenLine.range, replacementBlock);
    const success = await vscode2.workspace.applyEdit(edit);
    if (success) {
      await document.save();
    }
    return success;
  } catch (error) {
    console.error("Ai-Inspector Target File Error:", error);
    vscode2.window.showErrorMessage(`Ai-Inspector: Could not target file ${targetFilePath}`);
    return false;
  }
}
function getDeveloperIdentity() {
  return new Promise((resolve) => {
    (0, import_child_process.exec)("git config --global user.name", (error, stdout) => {
      if (!error && stdout.trim()) {
        resolve(stdout.trim());
        return;
      }
      const fullName = process.env.USERNAME || process.env.USER || os.userInfo().username || "Unknown Developer";
      resolve(os.userInfo().username);
    });
  });
}
async function markLogAsFixed(logId, updatedTag) {
  if (!logId) {
    return;
  }
  try {
    let url = `https://project-ai-75sc.onrender.com/logs/${logId}/apply`;
    if (updatedTag) {
      url += `?new_tag=${updatedTag}`;
    }
    await fetch(url, { method: "PATCH" });
  } catch (err) {
    console.error("Could not update fix status on backend dashboard:", err);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
