import type { ReferenceImage } from "@/types/image";

export type BrowserImageTarget = "chatgpt" | "gemini";

type BrowserImageBridgeRequest = {
    target: BrowserImageTarget;
    prompt: string;
    referenceImages: ReferenceImage[];
    requestId?: string;
    timeoutMs?: number;
};

type BrowserImageBridgeResponse = {
    requestId: string;
    ok: boolean;
    dataUrl?: string;
    mimeType?: string;
    error?: string;
};

const REQUEST_EVENT = "infinite-canvas-browser-image-request";
const ACCEPTED_EVENT = "infinite-canvas-browser-image-accepted";
const RESPONSE_EVENT = "infinite-canvas-browser-image-response";
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const BRIDGE_ACCEPT_TIMEOUT_MS = 4000;

export function requestBrowserImageGeneration({ target, prompt, referenceImages, requestId = crypto.randomUUID(), timeoutMs = DEFAULT_TIMEOUT_MS }: BrowserImageBridgeRequest) {
    return new Promise<{ dataUrl: string; mimeType?: string }>((resolve, reject) => {
        if (typeof window === "undefined" || typeof document === "undefined") {
            reject(new Error("浏览器插件桥接只能在浏览器中使用"));
            return;
        }

        let accepted = false;
        let timer = 0;
        let acceptTimer = 0;
        const cleanup = () => {
            window.clearTimeout(timer);
            window.clearTimeout(acceptTimer);
            document.removeEventListener(ACCEPTED_EVENT, handleAccepted as EventListener);
            document.removeEventListener(RESPONSE_EVENT, handleResponse as EventListener);
        };

        const handleAccepted = (event: CustomEvent<{ requestId: string }>) => {
            if (event.detail?.requestId !== requestId) return;
            accepted = true;
            window.clearTimeout(acceptTimer);
        };

        const handleResponse = (event: CustomEvent<BrowserImageBridgeResponse>) => {
            const detail = event.detail;
            if (!detail || detail.requestId !== requestId) return;
            cleanup();
            if (!detail.ok || !detail.dataUrl) {
                reject(new Error(detail.error || "浏览器插件生成失败"));
                return;
            }
            resolve({ dataUrl: detail.dataUrl, mimeType: detail.mimeType });
        };

        timer = window.setTimeout(() => {
            cleanup();
            reject(new Error("浏览器插件未返回生成结果，请确认插件已安装，并保持 ChatGPT/Gemini 页面可用"));
        }, timeoutMs);
        acceptTimer = window.setTimeout(() => {
            if (accepted) return;
            cleanup();
            reject(new Error("没有检测到浏览器插件，请安装或刷新「无限画布 Agent 转发器」后重试"));
        }, BRIDGE_ACCEPT_TIMEOUT_MS);

        document.addEventListener(ACCEPTED_EVENT, handleAccepted as EventListener);
        document.addEventListener(RESPONSE_EVENT, handleResponse as EventListener);
        document.dispatchEvent(
            new CustomEvent(REQUEST_EVENT, {
                detail: {
                    requestId,
                    target,
                    prompt,
                    referenceImages: referenceImages.map((image, index) => ({
                        id: image.id || `reference-${index + 1}`,
                        name: image.name || `reference-${index + 1}.png`,
                        type: image.type || "image/png",
                        dataUrl: image.dataUrl,
                    })),
                },
            }),
        );
    });
}
