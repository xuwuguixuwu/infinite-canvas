import { useEffect } from "react";
import type { ReactNode } from "react";
import { ImagePlus, Plus, Trash2, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ContextMenuState } from "@/types/canvas";

export function CanvasNodeContextMenu({
    menu,
    onClose,
    onDuplicate,
    onDelete,
    onAddImage,
    onAddVideo,
}: {
    menu: ContextMenuState;
    onClose: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onAddImage: () => void;
    onAddVideo: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    return (
        <div
            className="fixed z-[80] min-w-44 overflow-hidden rounded-xl border py-1 shadow-2xl"
            style={{ left: menu.x, top: menu.y, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {menu.type === "canvas" ? <MenuButton icon={<ImagePlus className="size-4" />} label="添加图片生成器" onClick={onAddImage} /> : null}
            {menu.type === "canvas" ? <MenuButton icon={<Video className="size-4" />} label="添加视频生成器" onClick={onAddVideo} /> : null}
            {menu.type === "node" ? <MenuButton icon={<Plus className="size-4" />} label="复制" onClick={onDuplicate} /> : null}
            {menu.type !== "canvas" ? <MenuButton icon={<Trash2 className="size-4" />} label="删除" onClick={onDelete} danger /> : null}
        </div>
    );
}

function MenuButton({ icon, label, onClick, danger = false }: { icon: ReactNode; label: string; onClick?: () => void; danger?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:opacity-80" style={{ color: danger ? "#f87171" : theme.node.text }} onClick={onClick}>
            {icon}
            <span>{label}</span>
        </button>
    );
}
