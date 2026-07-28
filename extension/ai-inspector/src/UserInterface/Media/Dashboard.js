const vscode = acquireVsCodeApi();

const state = {
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

function update(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
}

function updateBackendBadge(status) {

    const badge = document.getElementById("backendBadge");

    if (!badge) return;

    const online =
        status.toLowerCase().includes("online");

    badge.textContent = online ? "🟢 Online" : "🔴 Offline";

    badge.className =
        online ? "backend online" : "backend offline";
}

function render(viewState) {

    update("dashboardStatus", viewState.status);

    update("backendStatus", viewState.backendStatus);

    update("mode", viewState.mode);

    update("currentFile", viewState.currentFile);

    update("errorsDetected", viewState.stats.errorsDetected);

    update("errorsFixed", viewState.stats.errorsFixed);

    update("manualFixes", viewState.stats.manualFixes);

    update("reruns", viewState.stats.reruns);

    update("sessionTime", viewState.stats.sessionTime);

    update("successRate", viewState.stats.successRate);

    update("aiResponse", viewState.stats.aiResponse);

    updateBackendBadge(viewState.backendStatus);

    const activityList =
        document.getElementById("activityList");

    activityList.innerHTML = "";

    if (
        !viewState.activity ||
        viewState.activity.length === 0
    ) {

        activityList.innerHTML =
            "<li>No recent activity.</li>";

        return;
    }

    viewState.activity.forEach(activity => {

        const li = document.createElement("li");

        li.textContent = activity;

        activityList.appendChild(li);

    });
}

window.addEventListener("message", event => {

    const message = event.data;

    switch (message.type) {

        case "dashboardState":

            render(message.state);

            vscode.setState(message.state);

            break;

    }

});

const previousState = vscode.getState();

if (previousState) {

    render(previousState);

}