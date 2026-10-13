import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { useApp } from "@/stores/app";
import { APP_MODES } from "@/components/AppHeader";
import { ArrowRight, Search, Settings } from "lucide-react";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onOpenSettings,
}: CommandPaletteProps) {
  const { setAppMode } = useApp();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const modeItems = APP_MODES.map((m) => ({
      id: m.mode,
      title: m.title,
      desc: m.desc,
      icon: m.icon,
      action: () => {
        setAppMode(m.mode);
        onOpenChange(false);
      },
    }));

    const settingsItem = {
      id: "settings",
      title: "应用设置",
      desc: "打开编辑器路径、主题等基础设置",
      icon: Settings,
      action: () => {
        onOpenSettings();
        onOpenChange(false);
      },
    };

    const all = [...modeItems, settingsItem];
    if (!q) return all;

    return all.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.desc.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q),
    );
  }, [query, setAppMode, onOpenChange, onOpenSettings]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % Math.max(1, items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) =>
        prev <= 0 ? items.length - 1 : prev - 1,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[activeIndex]) {
        items[activeIndex].action();
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="max-w-xl" showClose={false} className="p-0 overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
          <Search className="h-4 w-4 text-fg-subtle shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索工作台、模式或功能... (↑↓ 选择, Enter 进入)"
            className="w-full bg-transparent text-sm text-fg placeholder:text-fg-subtle outline-none"
          />
          <kbd className="hidden rounded bg-bg-muted px-1.5 py-0.5 text-[10px] text-fg-muted sm:inline-block">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <div className="py-8 text-center text-xs text-fg-muted">
              未找到匹配的命令或工作台
            </div>
          ) : (
            <div className="space-y-0.5">
              {items.map((item, idx) => {
                const Icon = item.icon;
                const isSelected = idx === activeIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={item.action}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition ${
                      isSelected
                        ? "bg-accent/15 text-accent"
                        : "text-fg hover:bg-bg-muted"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                          isSelected
                            ? "bg-accent text-accent-fg"
                            : "bg-accent/10 text-accent"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-fg truncate">
                          {item.title}
                        </div>
                        <div className="truncate text-[11px] text-fg-muted">
                          {item.desc}
                        </div>
                      </div>
                    </div>
                    {isSelected && (
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-70 ml-2" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-bg-subtle px-3 py-2 text-[11px] text-fg-subtle">
          <div className="flex items-center gap-3">
            <span>↑↓ 切换</span>
            <span>↵ 打开</span>
          </div>
          <span>按 Ctrl+K 随时呼出</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
