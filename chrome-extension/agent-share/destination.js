const target = location.hostname.includes("gemini.google.com") ? "gemini" : "chatgpt";
const shareStorageKey = `pending-agent-share:${target}`;
const imageStorageKey = `pending-browser-image:${target}`;
const expiresAfterMs = 15 * 60 * 1000;
let filledShareId = "";
let runningImageId = "";
let attempts = 0;

const timer = window.setInterval(() => void tick(), 700);
void tick();

async function tick() {
    if (++attempts > 1500) return window.clearInterval(timer);
    await deliverPendingShare();
    await deliverPendingImageGeneration();
}

async function deliverPendingShare() {
    const pending = (await chrome.storage.local.get(shareStorageKey))[shareStorageKey];
    if (!pending?.text) return;
    if (isExpired(pending)) {
        await chrome.storage.local.remove(shareStorageKey);
        return;
    }

    const composer = findComposer();
    if (!composer) return;
    if (filledShareId !== pending.id) {
        insertText(composer, pending.text);
        filledShareId = pending.id;
        return;
    }

    const sendButton = findSendButton();
    if (!isClickable(sendButton)) return;
    sendButton.click();
    await chrome.storage.local.remove(shareStorageKey);
}

async function deliverPendingImageGeneration() {
    const pending = (await chrome.storage.local.get(imageStorageKey))[imageStorageKey];
    if (!pending?.prompt || runningImageId === pending.id) return;
    if (isExpired(pending)) {
        await chrome.storage.local.remove(imageStorageKey);
        return;
    }
    runningImageId = pending.id;

    try {
        await uploadReferenceImages(pending.referenceImages || []);
        const composer = await waitFor(findComposer, 30_000);
        insertText(composer, pending.prompt);
        await delay(1500);
        const seenImages = collectExistingImages();
        const sendButton = await waitFor(() => {
            const button = findSendButton();
            return isClickable(button) ? button : null;
        }, 60_000);
        sendButton.click();

        const resultImage = await waitForGeneratedImage(seenImages, expiresAfterMs);
        const dataUrl = await imageToDataUrl(resultImage);
        await chrome.runtime.sendMessage({
            type: "BROWSER_IMAGE_RESULT_FROM_TARGET",
            target,
            requestId: pending.requestId,
            ok: true,
            dataUrl,
            mimeType: dataUrl.slice(5, dataUrl.indexOf(";")) || "image/png",
        });
        await chrome.storage.local.remove(imageStorageKey);
    } catch (error) {
        await chrome.runtime.sendMessage({
            type: "BROWSER_IMAGE_RESULT_FROM_TARGET",
            target,
            requestId: pending.requestId,
            ok: false,
            error: error instanceof Error ? error.message : "浏览器生成失败",
        });
        await chrome.storage.local.remove(imageStorageKey);
    } finally {
        runningImageId = "";
    }
}

function findComposer() {
    const selectors =
        target === "gemini"
            ? ["rich-textarea .ql-editor[contenteditable='true']", ".ql-editor[contenteditable='true']", "[contenteditable='true'][aria-label*='prompt' i]", "[contenteditable='true'][aria-label*='输入' i]"]
            : ["#prompt-textarea", "textarea[placeholder*='Message' i]", "textarea[placeholder*='消息' i]", "[contenteditable='true'][data-virtualkeyboard='true']"];
    return selectors.map((selector) => document.querySelector(selector)).find(Boolean) || null;
}

function findSendButton() {
    const selectors =
        target === "gemini"
            ? ["button[aria-label*='Send message' i]", "button[aria-label*='发送' i]", "button.send-button"]
            : ["button[data-testid='send-button']", "button[aria-label*='Send prompt' i]", "button[aria-label*='发送' i]"];
    return selectors.map((selector) => document.querySelector(selector)).find(Boolean) || null;
}

function findFileInput() {
    const selectors =
        target === "gemini"
            ? ["input[type='file'][accept*='image' i]", "input[type='file']"]
            : ["input[type='file'][accept*='image' i]", "input[type='file']"];
    return selectors.map((selector) => document.querySelector(selector)).find(Boolean) || null;
}

function findAttachButton() {
    const selectors =
        target === "gemini"
            ? ["button[aria-label*='Upload' i]", "button[aria-label*='上传' i]", "button[aria-label*='添加图片' i]", "button[aria-label*='Add image' i]"]
            : ["button[aria-label*='Attach' i]", "button[aria-label*='Upload' i]", "button[aria-label*='上传' i]", "button[aria-label*='附件' i]"];
    return selectors.map((selector) => document.querySelector(selector)).find(Boolean) || null;
}

async function uploadReferenceImages(referenceImages) {
    const images = referenceImages.filter((image) => typeof image.dataUrl === "string" && image.dataUrl.startsWith("data:"));
    if (!images.length) return;
    let input = findFileInput();
    if (!input) {
        const attachButton = findAttachButton();
        attachButton?.click();
        input = await waitFor(findFileInput, 10_000);
    }

    const dataTransfer = new DataTransfer();
    for (let index = 0; index < images.length; index += 1) {
        dataTransfer.items.add(await fileFromDataUrl(images[index], index));
    }
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await delay(2500);
}

async function fileFromDataUrl(image, index) {
    const response = await fetch(image.dataUrl);
    const blob = await response.blob();
    const type = image.type || blob.type || "image/png";
    const extension = type.includes("jpeg") ? "jpg" : type.includes("webp") ? "webp" : "png";
    return new File([blob], image.name || `reference-${index + 1}.${extension}`, { type });
}

async function waitForGeneratedImage(seenImages, timeoutMs) {
    return waitFor(() => {
        const allCandidates = Array.from(document.images)
            .filter(isLargeGeneratedCandidate)
            .filter((image) => !seenImages.elements.has(image) && !seenImages.keys.has(imageKey(image)))
            .sort((a, b) => imageScore(b) - imageScore(a));
        const assistantCandidates = allCandidates.filter(isAssistantGeneratedImage);
        return assistantCandidates[0] || allCandidates[0] || null;
    }, timeoutMs);
}

function collectExistingImages() {
    const images = Array.from(document.images);
    return {
        elements: new Set(images),
        keys: new Set(images.map(imageKey).filter(Boolean)),
    };
}

function isLargeGeneratedCandidate(image) {
    const width = image.naturalWidth || image.width || 0;
    const height = image.naturalHeight || image.height || 0;
    const src = image.currentSrc || image.src || "";
    if (!src || src.startsWith("chrome-extension://")) return false;
    if (width < 180 || height < 180) return false;
    const rect = image.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 120) return false;
    if (isInsideUserMessage(image)) return false;
    if (isInsideComposerOrUserPrompt(image)) return false;
    return true;
}

function isAssistantGeneratedImage(image) {
    if (target === "chatgpt") {
        return Boolean(
            image.closest('[data-message-author-role="assistant"], article[data-testid*="conversation-turn" i] [data-message-author-role="assistant"]'),
        );
    }
    if (target === "gemini") {
        return Boolean(
            image.closest(
                [
                    "model-response",
                    "[data-response-index]",
                    "[id*='model-response' i]",
                    "[class*='model-response' i]",
                    "[class*='response-container' i]",
                ].join(","),
            ),
        );
    }
    return false;
}

function isInsideUserMessage(image) {
    return Boolean(
        image.closest(
            [
                '[data-message-author-role="user"]',
                "[data-testid*='user' i]",
                "[class*='user-message' i]",
                "[class*='query' i]",
            ].join(","),
        ),
    );
}

function isInsideComposerOrUserPrompt(image) {
    const composer = findComposer();
    if (composer && (composer === image || composer.contains(image))) return true;
    return Boolean(
        image.closest(
            [
                "form",
                "[contenteditable='true']",
                "[data-testid*='composer' i]",
                "[data-testid*='prompt' i]",
                "[aria-label*='Message' i]",
                "[aria-label*='消息' i]",
                "[aria-label*='prompt' i]",
            ].join(","),
        ),
    );
}

function imageScore(image) {
    const rect = image.getBoundingClientRect();
    const src = image.currentSrc || image.src || "";
    let score = rect.width * rect.height;
    if (isAssistantGeneratedImage(image)) score *= 12;
    if (/oaiusercontent|oaidalleapiprodscus|filesystem|generations|imagegen|googleusercontent/i.test(src)) score *= 2;
    if (rect.top > window.innerHeight * 0.18) score *= 1.15;
    return score;
}

function imageKey(image) {
    return image.currentSrc || image.src || `${image.naturalWidth}x${image.naturalHeight}:${image.alt || ""}`;
}

async function imageToDataUrl(image) {
    const src = image.currentSrc || image.src;
    if (!src) throw new Error("未找到生成图片地址");
    if (src.startsWith("data:")) return src;
    const response = await fetch(src);
    if (!response.ok) throw new Error("无法读取生成图片");
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("生成图片读取失败"));
        reader.readAsDataURL(blob);
    });
}

function insertText(element, text) {
    element.focus();
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        setter?.call(element, text);
    } else {
        element.replaceChildren(document.createTextNode(text));
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
}

function isClickable(element) {
    return Boolean(element && !element.disabled && element.getAttribute("aria-disabled") !== "true");
}

function isExpired(pending) {
    return Date.now() - pending.createdAt > expiresAfterMs;
}

function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitFor(getter, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const value = getter();
        if (value) return value;
        await delay(500);
    }
    throw new Error("等待页面元素或生成结果超时");
}
