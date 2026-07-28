import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

interface DashboardState {
    status: string;
    backendStatus: string;
    mode: string;
    currentFile: string;
    activity: string[];

    stats: {
        errorsDetected: number;
        errorsFixed: number;
        manualFixes: number;
        reruns: number;
        sessionTime: string;
        successRate: string;
        aiResponse: string;
    };
}

export class WebviewDashboardProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = "aiInspectorDashboard";

    private _view?: vscode.WebviewView;

    private state: DashboardState = {

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

    constructor(
        private readonly extensionUri: vscode.Uri
    ) { }

    public resolveWebviewView(

        webviewView: vscode.WebviewView,

        _context: vscode.WebviewViewResolveContext,

        _token: vscode.CancellationToken

    ) {

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

        webviewView.webview.html =
            this.getHtmlForWebview(webviewView.webview);

        this.postState();
    }

    // ====================================================
    // Public Update Methods
    // ====================================================

    public setStatus(status: string) {

        this.state.status = status;

        this.postState();

    }

    public setBackendStatus(status: string) {

        this.state.backendStatus = status;

        this.postState();

    }

    public setMode(mode: string) {

        this.state.mode = mode;

        this.postState();

    }

    public setCurrentFile(file: string) {

        this.state.currentFile = file;

        this.postState();

    }

    public setActivities(activity: string[]) {

        this.state.activity = activity;

        this.postState();

    }

    public setStats(stats: Partial<DashboardState["stats"]>) {

        this.state.stats = {

            ...this.state.stats,

            ...stats

        };

        this.postState();

    }

    // ====================================================
    // Send State
    // ====================================================

    private postState() {

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

    private getHtmlForWebview(
        webview: vscode.Webview
    ): string {

        const htmlPath = path.join(

            this.extensionUri.fsPath,

            "src",

            "UserInterface",

            "Media",

            "Dashboard.html"

        );

        let html =
            fs.readFileSync(htmlPath, "utf8");

        const styleUri =
            webview.asWebviewUri(

                vscode.Uri.joinPath(

                    this.extensionUri,

                    "src",

                    "UserInterface",

                    "Media",

                    "Dashboard.css"

                )

            );

        const scriptUri =
            webview.asWebviewUri(

                vscode.Uri.joinPath(

                    this.extensionUri,

                    "src",

                    "UserInterface",

                    "Media",

                    "Dashboard.js"

                )

            );

        const logoUri =
            webview.asWebviewUri(

                vscode.Uri.joinPath(

                    this.extensionUri,

                    "src",

                    "UserInterface",

                    "Media",

                    "tennis-badge.png"

                )

            );

        const nonce = getNonce();

        html = html
            .replace(/\$\{styleUri\}/g, styleUri.toString())
            .replace(/\$\{scriptUri\}/g, scriptUri.toString())
            .replace(/\$\{logoUri\}/g, logoUri.toString())
            .replace(/\$\{nonce\}/g, nonce)
            .replace(/\$\{webview\.cspSource\}/g, webview.cspSource);

        return html;
    }

}

function getNonce() {

    let text = "";

    const possible =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (let i = 0; i < 32; i++) {

        text += possible.charAt(

            Math.floor(Math.random() * possible.length)

        );

    }

    return text;

}