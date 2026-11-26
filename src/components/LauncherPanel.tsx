import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AppWindow, Loader2, Pin, Search, Settings, X } from "lucide-react";
import { tauri } from "@/lib/tauri";
import { activateLauncherEntry, buildLauncherEntries, filterLauncherEntries, LAUNCHER_HISTORY_KEY, moveLauncherSelection, readLauncherHistory, rememberLauncherEntry, writeLauncherHistory, type LauncherEntry, type LauncherNavigationKey } from "@/lib/launcher";
import type { AppMode } from "@/stores/app";

interface Props {
  open: boolean;
  onClose: () => void | Promise<void>;
  onOpenMode: (mode: AppMode, toolId?: string) => Promise<void>;
  standalone?: boolean;
  session?: number;
}

export function LauncherPanel({ open, onClose, onOpenMode, standalone = false, session = 0 }: Props) {
  const [entries, setEntries] = useState(() => buildLauncherEntries([]));
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [history, setHistory] = useState(readLauncherHistory);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const navigation = useRef<{ id: string; preferredX: number; layout: string } | null>(null);
  const hintId = useId();
  const statusId = useId();
  const running = useRef(false);
  const focusToRestore = useRef<HTMLElement | null>(null);
  const revision = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (busy) return;
    const previous = focusToRestore.current;
    focusToRestore.current = null;
    // A disabled launch button loses focus. Restore it after React enables it again,
    // unless the user has already moved to another control while waiting.
    if (open && previous && document.activeElement === document.body) {
      (previous.isConnected ? previous : input.current)?.focus({ preventScroll: true });
    }
  }, [busy, open]);

  const refresh = useCallback(async () => {
    const current = ++revision.current;
    setLoading(true);
    try {
      const catalog = await tauri.launcherCatalog();
      if (!alive.current || current !== revision.current) return;
      setEntries(buildLauncherEntries(catalog));
      setError(null);
    } catch (failure) {
      if (!alive.current || current !== revision.current) return;
      setEntries(buildLauncherEntries([]));
      setError(`工具列表读取失败：${String(failure)}`);
    } finally {
      if (alive.current && current === revision.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedId(null);
    navigation.current = null;
    setHistory(readLauncherHistory());
    void refresh();
    input.current?.focus();
  }, [open, refresh, session]);

  useEffect(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    for (const event of ["devhub:settings-changed", "devhub:tools-changed"]) {
      void listen(event, () => { if (open) void refresh(); }).then((stop) => {
        if (disposed) stop(); else stops.push(stop);
      }).catch((failure) => { if (!disposed) setError(String(failure)); });
    }
    const storage = (event: StorageEvent) => { if (event.key === LAUNCHER_HISTORY_KEY) setHistory(readLauncherHistory()); };
    window.addEventListener("storage", storage);
    return () => { disposed = true; stops.forEach((stop) => stop()); window.removeEventListener("storage", storage); };
  }, [open, refresh]);

  const groups = useMemo(() => {
    const filtered = filterLauncherEntries(entries, query);
    if (query.trim()) return [{ title: "搜索结果", items: filtered }];
    const used = new Set<string>();
    const select = (ids: string[]) => ids.flatMap((id) => {
      const entry = filtered.find((entry) => entry.id === id);
      if (!entry || used.has(id)) return [];
      used.add(id);
      return [entry];
    });
    const pinned = select(history.pinned);
    const recent = select(history.recent.slice(0, 6));
    return [
      { title: "已固定", items: pinned },
      { title: "最近使用", items: recent },
      { title: "功能模式", items: filtered.filter((entry) => entry.kind === "mode" && !used.has(entry.id)) },
      { title: "工具", items: filtered.filter((entry) => entry.kind !== "mode" && !used.has(entry.id)) },
    ].filter((group) => group.items.length);
  }, [entries, query, history]);
  const visible = groups.flatMap((group) => group.items);
  const active = visible.find((entry) => entry.id === selectedId) ?? visible[0];
  const searching = !!query.trim();

  useEffect(() => {
    if (open && active) document.getElementById(`launcher-${active.id}`)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, [open, active?.id, groups]);

  function selectEntry(id: string) {
    if (navigation.current?.id !== id) navigation.current = null;
    setSelectedId(id);
  }

  function moveSelection(key: LauncherNavigationKey, moveFocus: boolean) {
    const container = list.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("[data-launcher-entry]")];
    const items = buttons.map((button) => {
      const rect = button.parentElement!.getBoundingClientRect();
      return { id: button.dataset.launcherEntry!, left: rect.left - bounds.left, top: rect.top - bounds.top + container.scrollTop, width: rect.width };
    });
    // Scrolling preserves the anchor; resizing, filtering or regrouping resets it.
    const layout = JSON.stringify(items);
    const previous = navigation.current;
    const preferredX = previous?.id === active?.id && previous?.layout === layout ? previous.preferredX : undefined;
    const next = moveLauncherSelection(items, active?.id, key, preferredX);
    if (!next) return;
    navigation.current = { ...next, layout };
    setSelectedId(next.id);
    const button = buttons.find((button) => button.dataset.launcherEntry === next.id);
    if (moveFocus) button?.focus({ preventScroll: true });
    button?.parentElement?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }

  function updateHistory(next: typeof history) { setHistory(next); writeLauncherHistory(next); }
  async function dismiss() {
    if (running.current) return;
    try { await onClose(); }
    catch (failure) { if (alive.current) setError(String(failure)); }
  }
  async function activate(entry: LauncherEntry) {
    if (running.current) return;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    running.current = true;
    setBusy(entry.id);
    setError(null);
    try {
      await activateLauncherEntry(entry, onOpenMode);
      updateHistory(rememberLauncherEntry(readLauncherHistory(), entry.id));
      await onClose();
    } catch (failure) {
      if (alive.current) { focusToRestore.current = focused; setError(String(failure)); }
    }
    finally { running.current = false; if (alive.current) setBusy(null); }
  }

  function keyDown(event: React.KeyboardEvent) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const fromInput = event.target === input.current;
    const fromEntry = event.target instanceof HTMLElement && event.target.hasAttribute("data-launcher-entry");
    if (event.key === "Escape") { event.preventDefault(); void dismiss(); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
      if (!fromInput && !fromEntry) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (fromInput && query.length && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End")) return;
      event.preventDefault();
      if (running.current) return;
      moveSelection(event.key, fromEntry);
    } else if (event.key === "Enter" && (fromInput || fromEntry)) {
      event.preventDefault();
      if (active && !event.repeat) void activate(active);
    }
  }

  return (
    <div className={`flex flex-col overflow-hidden bg-bg text-fg ${standalone ? "h-full" : "h-[540px] max-h-[85vh]"}`} onKeyDown={keyDown}>
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
        <Search className="h-5 w-5 shrink-0 text-accent" />
        <input ref={input} autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setSelectedId(null); navigation.current = null; }}
          aria-label="搜索模式或工具" aria-describedby={`${hintId} ${statusId}`} placeholder="搜索模式或工具…" className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-fg-subtle" />
        {loading && <Loader2 className="h-4 w-4 animate-spin text-fg-muted" />}
        <button type="button" aria-label="打开应用设置" title="应用设置" disabled={!!busy} onClick={() => void activate(entries.find((entry) => entry.id === "mode:settings")!)} className="rounded-md p-1.5 text-fg-muted hover:bg-bg-muted"><Settings className="h-4 w-4" /></button>
        <button type="button" aria-label="收起快捷面板" disabled={!!busy} onClick={() => void dismiss()} className="rounded-md p-1.5 text-fg-muted hover:bg-bg-muted"><X className="h-4 w-4" /></button>
      </div>
      {error && <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-danger/20 bg-danger/10 px-5 py-2 text-xs text-danger"><span className="flex-1 break-all">{error}</span><button type="button" disabled={!!busy} className="shrink-0 underline" onClick={() => void refresh()}>刷新列表</button></div>}
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto p-4">
        {!visible.length && <div className="py-14 text-center text-sm text-fg-muted">未找到匹配的模式或工具</div>}
        {groups.map((group) => <section key={group.title} className="mb-5 last:mb-0">
          <h2 className="mb-2 px-1 text-xs font-medium text-fg-muted">{group.title}</h2>
          <div className={searching ? "space-y-1" : "grid gap-2"} style={searching ? undefined : { gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))" }}>
            {group.items.map((entry) => {
              const Icon = entry.icon ?? AppWindow;
              const selected = active?.id === entry.id;
              const pinned = history.pinned.includes(entry.id);
              return <div key={entry.id} id={`launcher-${entry.id}`} data-selected={selected} className={`group relative rounded-xl border ${selected ? "border-accent/50 bg-accent/10 ring-1 ring-accent/30" : "border-transparent hover:bg-bg-muted"}`}>
                <button type="button" data-launcher-entry={entry.id} tabIndex={selected ? 0 : -1} aria-current={selected ? "true" : undefined} disabled={!!busy} onFocus={() => selectEntry(entry.id)} onClick={() => { selectEntry(entry.id); void activate(entry); }}
                  title={`${entry.title}\n${entry.desc}\n${entry.status}`} aria-label={`${entry.title}，${entry.status}`}
                  className={`flex w-full rounded-xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${searching ? "items-center gap-3 pr-10" : "min-h-[104px] flex-col items-center text-center"}`}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">{busy === entry.id ? <Loader2 className="h-6 w-6 animate-spin" /> : <Icon className="h-6 w-6" />}</span>
                  <span className={`min-w-0 ${searching ? "flex-1" : "mt-2 w-full"}`}><span className="block truncate text-xs font-medium">{entry.title}</span>
                    {searching && <span className="block truncate text-[11px] text-fg-muted">{entry.desc}</span>}
                    <span className={`mt-0.5 block text-[10px] ${entry.available ? "text-fg-subtle" : "text-warning"}`}>{entry.status}</span></span>
                </button>
                <button type="button" tabIndex={selected ? 0 : -1} aria-label={`${pinned ? "取消固定" : "固定"}${entry.title}`} aria-pressed={pinned} disabled={!!busy}
                  onClick={() => { const current = readLauncherHistory(); selectEntry(entry.id); navigation.current = null; updateHistory({ ...current, pinned: pinned ? current.pinned.filter((id) => id !== entry.id) : [...current.pinned, entry.id] }); input.current?.focus({ preventScroll: true }); }}
                  className={`absolute right-1 top-1 rounded p-1 focus:opacity-100 ${pinned ? "text-accent" : "text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-accent"}`}><Pin className="h-3 w-3" /></button>
              </div>;
            })}
          </div>
        </section>)}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border bg-bg-subtle px-5 py-2.5 text-[11px] text-fg-muted">
        <span id={hintId}>{searching ? "↑ ↓ 选择 · ← → 编辑" : "方向键选择 · Home / End 首尾"} · 回车打开 · Esc 收起</span>
        <span id={statusId} role="status" className="min-w-0 truncate" title={active?.title}>{active ? `${active.title} · ${visible.indexOf(active) + 1} / ${visible.length}` : "没有匹配结果"}</span>
      </footer>
    </div>
  );
}
