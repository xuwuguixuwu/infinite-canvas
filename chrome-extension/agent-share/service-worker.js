const TARGETS = {
    chatgpt: "https://chatgpt.com/",
    gemini: "https://gemini.google.com/app",
};
const LAST_BROWSER_IMAGE_RESULT_KEY = "dotai-last-browser-image-result";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "OPEN_SHARE_TARGET") {
        const url = TARGETS[message.target];
        if (!url || typeof message.text !== "string" || !message.text.trim()) {
            sendResponse({ ok: false, error: "转发参数无效" });
            return;
        }
        const key = `pending-agent-share:${message.target}`;
        chrome.storage.local
            .set({ [key]: { id: crypto.randomUUID(), text: message.text, createdAt: Date.now() } })
            .then(() => chrome.tabs.create({ url }))
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
    }

    if (message?.type === "START_BROWSER_IMAGE_GENERATION") {
        const url = TARGETS[message.target];
        const prompt = typeof message.prompt === "string" ? message.prompt.trim() : "";
        if (!url || !prompt || !_sender.tab?.id) {
            sendResponse({ ok: false, error: "图片生成参数无效" });
            return;
        }
        const requestId = message.requestId || crypto.randomUUID();
        const key = `pending-browser-image:${message.target}`;
        chrome.storage.local
            .set({
                [key]: {
                    id: requestId,
                    requestId,
                    target: message.target,
                    prompt,
                    referenceImages: Array.isArray(message.referenceImages) ? message.referenceImages : [],
                    dotaiJob: message.dotaiJob || null,
                    canvasTabId: _sender.tab.id,
                    createdAt: Date.now(),
                },
            })
            .then(() => chrome.tabs.create({ url }))
            .then(() => sendResponse({ ok: true, requestId }))
            .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
    }

    if (message?.type === "BROWSER_IMAGE_RESULT_FROM_TARGET") {
        const requestId = message.requestId;
        const target = message.target;
        const key = `pending-browser-image:${target}`;
        chrome.storage.local
            .get(key)
            .then(async (items) => {
                const pending = items[key];
                if (!pending || pending.requestId !== requestId || !pending.canvasTabId) return null;
                const payload = {
                    type: "BROWSER_IMAGE_GENERATION_RESULT",
                    requestId,
                    ok: Boolean(message.ok),
                    dataUrl: message.dataUrl,
                    mimeType: message.mimeType,
                    error: message.error,
                    targetNodeId: pending.dotaiJob?.targetNodeId,
                    prompt: pending.dotaiJob?.prompt || pending.prompt,
                    task: pending.dotaiJob?.task,
                    createdAt: Date.now(),
                };
                if (payload.ok) {
                    await chrome.storage.local.set({ [LAST_BROWSER_IMAGE_RESULT_KEY]: payload }).catch(() => undefined);
                }
                await Promise.allSettled([
                    chrome.tabs.sendMessage(pending.canvasTabId, payload),
                    broadcastToCanvasTabs(payload),
                ]);
                return chrome.storage.local.remove(key);
            })
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
    }
});

async function broadcastToCanvasTabs(payload) {
    const tabs = await chrome.tabs.query({});
    const canvasTabs = tabs.filter((tab) => {
        const url = tab.url || "";
        return (
            url.startsWith("https://xuwugui.com/agent/") ||
            url.startsWith("http://xuwugui.com/agent/") ||
            url.startsWith("http://localhost/") ||
            url.startsWith("http://127.0.0.1/")
        );
    });
    await Promise.allSettled(canvasTabs.map((tab) => (tab.id ? chrome.tabs.sendMessage(tab.id, payload) : Promise.resolve())));
}
