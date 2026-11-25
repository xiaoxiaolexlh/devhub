import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AppWindow, Loader2, Pin, Search, Settings, X } from "lucide-react";
import { tauri } from "@/lib/tauri";
import { activateLauncherEntry, buildLauncherEntries, filterLauncherEntries, LAUNCHER_HISTORY_KEY, readLauncherHistory, rememberLauncherEntry, writeLauncherHistory, type LauncherEntry } from "@/lib/launcher";
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
  const running = useRef(false);
  const revision = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

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

  useEffect(() => {
    if (active) document.getElementById(`launcher-${active.id}`)?.scrollIntoView({ block: "nearest" });
  }, [active?.id]);

  function updateHistory(next: typeof history) { setHistory(next); writeLauncherHistory(next); }
  async function dismiss() {
    if (running.current) return;
    try { await onClose(); }
    catch (failure) { if (alive.current) setError(String(failure)); }
  }
  async function activate(entry: LauncherEntry) {
    if (running.current) return;
    running.current = true;
    setBusy(entry.id);
    setError(null);
    try {
      await activateLauncherEntry(entry, onOpenMode);
      updateHistory(rememberLauncherEntry(readLauncherHistory(), entry.id));
      await onClose();
    } catch (failure) { if (alive.current) setError(String(failure)); }
    finally { running.current = false; if (alive.current) setBusy(null); }
  }

  function keyDown(event: React.KeyboardEvent) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); void dismiss(); }
    else if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const columns = query.trim() ? 1 : 6;
      const delta = event.key === "ArrowDown" ? columns : event.key === "ArrowUp" ? -columns : event.key === "ArrowRight" ? 1 : -1;
      if (visible.length) {
        const current = visible.findIndex((entry) => entry.id === active?.id);
        setSelectedId(visible[((current + delta) % visible.length + visible.length) % visible.length].id);
      }
    } else if (event.key === "Enter" && event.target === input.current) {
      event.preventDefault();
      if (active) void activate(active);
    }
  }

  return (
    <div className={`flex flex-col overflow-hidden bg-bg text-fg ${standalone ? "h-full" : "h-[540px] max-h-[85vh]"}`} onKeyDown={keyDown}>
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
        <Search className="h-5 w-5 shrink-0 text-accent" />
        <input ref={input} autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setSelectedId(null); }}
          aria-label="搜索模式或工具" placeholder="搜索模式或工具…" className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-fg-subtle" />
        {loading && <Loader2 className="h-4 w-4 animate-spin text-fg-muted" />}
        <button type="button" aria-label="打开应用设置" title="应用设置" disabled={!!busy} onClick={() => void activate(entries.find((entry) => entry.id === "mode:settings")!)} className="rounded-md p-1.5 text-fg-muted hover:bg-bg-muted"><Settings className="h-4 w-4" /></button>
        <button type="button" aria-label="收起快捷面板" disabled={!!busy} onClick={() => void dismiss()} className="rounded-md p-1.5 text-fg-muted hover:bg-bg-muted"><X className="h-4 w-4" /></button>
      </div>
      {error && <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-danger/20 bg-danger/10 px-5 py-2 text-xs text-danger"><span className="flex-1 break-all">{error}</span><button type="button" disabled={!!busy} className="shrink-0 underline" onClick={() => void refresh()}>刷新列表</button></div>}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!visible.length && <div className="py-14 text-center text-sm text-fg-muted">未找到匹配的模式或工具</div>}
        {groups.map((group) => <section key={group.title} className="mb-5 last:mb-0">
          <h2 className="mb-2 px-1 text-xs font-medium text-fg-muted">{group.title}</h2>
          <div className={query.trim() ? "space-y-1" : "grid grid-cols-6 gap-2"}>
            {group.items.map((entry) => {
              const Icon = entry.icon ?? AppWindow;
              const selected = active?.id === entry.id;
              const pinned = history.pinned.includes(entry.id);
              return <div key={entry.id} id={`launcher-${entry.id}`} className={`group relative rounded-xl border transition ${selected ? "border-accent/50 bg-accent/10" : "border-transparent hover:bg-bg-muted"}`}>
                <button type="button" disabled={!!busy} onFocus={() => setSelectedId(entry.id)} onMouseEnter={() => setSelectedId(entry.id)} onClick={() => void activate(entry)}
                  title={`${entry.title}\n${entry.desc}\n${entry.status}`} aria-label={`${entry.title}，${entry.status}`}
                  className={`flex w-full rounded-xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${query.trim() ? "items-center gap-3 pr-10" : "min-h-[104px] flex-col items-center text-center"}`}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">{busy === entry.id ? <Loader2 className="h-6 w-6 animate-spin" /> : <Icon className="h-6 w-6" />}</span>
                  <span className={`min-w-0 ${query.trim() ? "flex-1" : "mt-2 w-full"}`}><span className="block truncate text-xs font-medium">{entry.title}</span>
                    {query.trim() && <span className="block truncate text-[11px] text-fg-muted">{entry.desc}</span>}
                    <span className={`mt-0.5 block text-[10px] ${entry.available ? "text-fg-subtle" : "text-warning"}`}>{entry.status}</span></span>
                </button>
                <button type="button" aria-label={`${pinned ? "取消固定" : "固定"}${entry.title}`} aria-pressed={pinned} disabled={!!busy}
                  onClick={() => { const current = readLauncherHistory(); updateHistory({ ...current, pinned: pinned ? current.pinned.filter((id) => id !== entry.id) : [...current.pinned, entry.id] }); }}
                  className={`absolute right-1 top-1 rounded p-1 focus:opacity-100 ${pinned ? "text-accent" : "text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-accent"}`}><Pin className="h-3 w-3" /></button>
              </div>;
            })}
          </div>
        </section>)}
      </div>
      <footer className="flex shrink-0 items-center justify-between border-t border-border bg-bg-subtle px-5 py-2.5 text-[11px] text-fg-muted"><span>方向键选择 · 回车打开 · Esc 收起</span><span>DevHub 快捷面板</span></footer>
    </div>
  );
}
