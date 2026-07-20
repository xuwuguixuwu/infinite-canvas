const statusElement = document.querySelector("#status");
const buttons = [...document.querySelectorAll("button[data-target]")];

buttons.forEach((button) => {
    button.addEventListener("click", () => void share(button.dataset.target));
});

async function share(target) {
    setBusy(true);
    setStatus("正在读取无限画布 Agent 对话…");
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error("找不到当前标签页");
        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: "MAIN",
            func: readInfiniteCanvasAgent,
        });
        if (!result?.ok) throw new Error(result?.error || "无法读取 Agent 对话");

        const scope = document.querySelector('input[name="scope"]:checked')?.value || "full";
        const source = scope === "last" ? result.payload.lastAnswer : result.payload.fullConversation;
        if (!source?.trim()) throw new Error(scope === "last" ? "当前对话还没有 Agent 回复" : "当前 Agent 对话为空");

        const heading = result.payload.title ? `来自无限画布「${result.payload.title}」的 Agent 内容` : "来自无限画布 Agent 的内容";
        const text = `${heading}：\n\n${source.trim()}\n\n请基于以上内容继续协助我。`;
        const response = await chrome.runtime.sendMessage({ type: "OPEN_SHARE_TARGET", target, text });
        if (!response?.ok) throw new Error(response?.error || "打开目标网站失败");
        setStatus(`已打开 ${target === "chatgpt" ? "ChatGPT" : "Gemini"}，正在自动填入并发送。`, "success");
        window.setTimeout(() => window.close(), 900);
    } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), "error");
        setBusy(false);
    }
}

function setBusy(busy) {
    buttons.forEach((button) => { button.disabled = busy; });
}

function setStatus(text, state = "") {
    statusElement.textContent = text;
    statusElement.className = state;
}

function readInfiniteCanvasAgent() {
    return new Promise((resolve) => {
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const responseEvent = "infinite-canvas-agent-share-response";
        const timeout = window.setTimeout(() => {
            document.removeEventListener(responseEvent, onResponse);
            resolve({ ok: false, error: "当前页面不是支持转发的无限画布，或线上版本尚未更新" });
        }, 1800);
        const onResponse = (event) => {
            if (event.detail?.requestId !== requestId) return;
            window.clearTimeout(timeout);
            document.removeEventListener(responseEvent, onResponse);
            resolve({ ok: true, payload: event.detail.payload });
        };
        document.addEventListener(responseEvent, onResponse);
        document.dispatchEvent(new CustomEvent("infinite-canvas-agent-share-request", { detail: { requestId } }));
    });
}
