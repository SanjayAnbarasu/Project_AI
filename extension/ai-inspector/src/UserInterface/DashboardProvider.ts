import * as vscode from "vscode";

export class DashboardProvider
    implements vscode.TreeDataProvider<DashboardItem> {

    private _onDidChangeTreeData =
        new vscode.EventEmitter<void>();

    readonly onDidChangeTreeData =
        this._onDidChangeTreeData.event;

    private status = "Monitoring";

    private activities: string[] = [];

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    setStatus(status: string) {
        this.status = status;
        this.refresh();
    }

    setActivities(activity: string[]) {
        this.activities = activity;
        this.refresh();
    }

    getTreeItem(
        element: DashboardItem
    ): vscode.TreeItem {
        return element;
    }

    getChildren(
        element?: DashboardItem
    ): Thenable<DashboardItem[]> {

        if (element) {
            return Promise.resolve([]);
        }

        return Promise.resolve([

            new DashboardItem(
                `🟢 ${this.status}`
            ),

            new DashboardItem(""),

            new DashboardItem("Recent Activity"),

            ...this.activities.map(
                a => new DashboardItem(a)
            )

        ]);
    }

}

class DashboardItem
    extends vscode.TreeItem {

    constructor(label: string) {

        super(
            label,
            vscode.TreeItemCollapsibleState.None
        );

    }

}