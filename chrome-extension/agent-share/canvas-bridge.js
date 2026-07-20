const REQUEST_EVENT = "infinite-canvas-browser-image-request";
const ACCEPTED_EVENT = "infinite-canvas-browser-image-accepted";
const RESPONSE_EVENT = "infinite-canvas-browser-image-response";
const DOTAI_WEB_SOURCE = "dot-ai-web";
const DOTAI_BRIDGE_SOURCE = "dot-ai-chatgpt-bridge";
const LAST_BROWSER_IMAGE_RESULT_KEY = "dotai-last-browser-image-result";
let lastHandledResultId = sessionStorage.getItem("dotai-last-handled-result-id") || "";

document.addEventListener(REQUEST_EVENT, (event) => {
    const detail = event.detail || {};
    safeRuntimeSendMessage(
        {
            type: "START_BROWSER_IMAGE_GENERATION",
            requestId: detail.requestId,
            target: detail.target,
            prompt: detail.prompt,
            referenceImages: detail.referenceImages || [],
        },
        (response, runtimeError) => {
            if (runtimeError) {
                dispatchResponse({
                    requestId: detail.requestId,
                    ok: false,
                    error: runtimeError,
                });
                return;
            }
            if (!response?.ok) {
                dispatchResponse({
                    requestId: detail.requestId,
                    ok: false,
                    error: response?.error || "Chrome 插件启动失败",
                });
                return;
            }
            document.dispatchEvent(new CustomEvent(ACCEPTED_EVENT, { detail: { requestId: response.requestId || detail.requestId } }));
        },
    );
});

window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== DOTAI_WEB_SOURCE || data.type !== "DOT_AI_SEND_TO_CHATGPT") return;
    const job = data.job || {};
    const requestId = data.requestId || job.id || crypto.randomUUID();
    const target = job.provider === "gemini" ? "gemini" : "chatgpt";
    safeRuntimeSendMessage(
        {
            type: "START_BROWSER_IMAGE_GENERATION",
            requestId,
            target,
            prompt: job.prompt || "",
            referenceImages: normalizeDotaiReferences(job.references || []),
            dotaiJob: {
                targetNodeId: job.targetNodeId || "",
                prompt: job.prompt || "",
                task: job.task || "image",
            },
        },
        (response, runtimeError) => {
            if (runtimeError) {
                postDotaiStatus(requestId, runtimeError);
                return;
            }
            if (!response?.ok) {
                postDotaiStatus(requestId, response?.error || "Chrome 插件启动失败");
                return;
            }
            postDotaiAck(requestId, true, "图片任务已发送到浏览器插件。请在扩展面板完成生成和回填。");
        },
    );
});

chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "BROWSER_IMAGE_GENERATION_RESULT") return;
    handleBrowserImageResult(message);
});

chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const message = changes[LAST_BROWSER_IMAGE_RESULT_KEY]?.newValue;
    if (message?.type === "BROWSER_IMAGE_GENERATION_RESULT") handleBrowserImageResult(message);
});

void pollStoredBrowserImageResult();
window.setInterval(() => void pollStoredBrowserImageResult(), 2000);

async function pollStoredBrowserImageResult() {
    try {
        const items = await chrome.storage.local.get(LAST_BROWSER_IMAGE_RESULT_KEY);
        const message = items[LAST_BROWSER_IMAGE_RESULT_KEY];
        if (message?.type === "BROWSER_IMAGE_GENERATION_RESULT") handleBrowserImageResult(message);
    } catch {
        // 忽略轮询失败，直接消息通道仍可工作。
    }
}

function handleBrowserImageResult(message) {
    const resultId = message.requestId || `${message.targetNodeId}:${message.createdAt || ""}`;
    if (!resultId || resultId === lastHandledResultId) return;
    dispatchResponse(message);
    if (!message.ok) return;
    lastHandledResultId = resultId;
    sessionStorage.setItem("dotai-last-handled-result-id", resultId);
    window.postMessage(
        {
            source: DOTAI_BRIDGE_SOURCE,
            type: "DOT_AI_BACKFILL_IMAGE",
            requestId: message.requestId,
            targetNodeId: message.targetNodeId,
            imageUrl: message.dataUrl,
            prompt: message.prompt,
        },
        window.location.origin,
    );
}

function dispatchResponse(detail) {
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail }));
}

function safeRuntimeSendMessage(payload, callback) {
    try {
        if (!chrome?.runtime?.id || !chrome.runtime.sendMessage) {
            callback?.(null, "Chrome 扩展上下文已失效，请刷新 DOT AI 页面后重试。");
            return;
        }
        chrome.runtime.sendMessage(payload, (response) => {
            const error = chrome.runtime.lastError?.message || "";
            callback?.(response, error || null);
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Chrome 扩展上下文已失效";
        callback?.(null, message.includes("Extension context invalidated") ? "Chrome 扩展刚刚被更新/重载，请刷新 DOT AI 页面后重试。" : message);
    }
}

function postDotaiAck(requestId, ok, message) {
    window.postMessage(
        {
            source: DOTAI_BRIDGE_SOURCE,
            type: "DOT_AI_CHATGPT_BRIDGE_ACK",
            requestId,
            ok,
            message,
        },
        window.location.origin,
    );
}

function postDotaiStatus(requestId, message) {
    window.postMessage(
        {
            source: DOTAI_BRIDGE_SOURCE,
            type: "DOT_AI_CHATGPT_BRIDGE_ACK",
            requestId,
            ok: false,
            message,
        },
        window.location.origin,
    );
}

function normalizeDotaiReferences(references) {
    return references
        .filter((item) => typeof item?.dataUrl === "string" && item.dataUrl)
        .map((item, index) => ({
            id: item.id || `reference-${index + 1}`,
            name: item.title || `reference-${index + 1}.png`,
            type: "image/png",
            dataUrl: item.dataUrl,
        }));
}
