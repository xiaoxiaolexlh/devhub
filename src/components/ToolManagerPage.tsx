import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { confirm, open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  AppWindow,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  Package,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AppHeader } from "@/components/AppHeader";
import { cn } from "@/lib/utils";
import {
  tauri,
  type CustomTool,
  type ToolDownloadProgress,
  type ToolListItem,
} from "@/lib/tauri";
import { useApp } from "@/stores/app";

interface Props {
  onOpenSettings: () => void;
}

type Notice = { tone: "success" | "warning" | "error"; text: string } | null;

/** Synthetic group id for the user-defined "自定义工具" tab (not a backend group). */
const CUSTOM_GROUP = "__custom__";

function baseName(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
}

export function ToolManagerPage({ onOpenSettings }: Props) {
  const customTools = useApp((s) => s.settings?.custom_tools ?? []);
  const [tools, setTools] = useState<ToolListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingIds, setCheckingIds] = useState<string[]>([]);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [progressById, setProgressById] = useState<
    Record<string, ToolDownloadProgress>
  >({});
  const downloadingRef = useRef<Set<string>>(new Set());
  const [notice, setNotice] = useState<Notice>(null);
  const [isElevated, setIsElevated] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string>("all");
  const [dropActive, setDropActive] = useState(false);

  // 分组来自后端写死的 TOOL_GROUPS,这里按工具列表首次出现顺序去重,
  // 顺序与 registry 一致(即 TOOL_GROUPS 定义顺序)。
  const groups = useMemo(() => {
    const seen = new Map<string, string>();
    for (const tool of tools) {
      if (!seen.has(tool.group)) seen.set(tool.group, tool.groupName);
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [tools]);

  const visibleTools =
    selectedGroup === "all"
      ? tools
      : tools.filter((tool) => tool.group === selectedGroup);

  // 工具列表刷新后,若当前选中的分组已不存在,回退到「全部」。
  // 自定义工具分组(CUSTOM_GROUP)始终存在,不参与回退判断。
  useEffect(() => {
    if (
      selectedGroup !== "all" &&
      selectedGroup !== CUSTOM_GROUP &&
      !groups.some((g) => g.id === selectedGroup)
    ) {
      setSelectedGroup("all");
    }
  }, [groups, selectedGroup]);

  const countFor = (id: string) =>
    id === "all"
      ? tools.length
      : id === CUSTOM_GROUP
        ? customTools.length
        : tools.filter((t) => t.group === id).length;

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    void tauri.toolIsElevated().then(setIsElevated).catch(() => {});
  }, []);

  useEffect(() => {
    const unlisten = tauri.onToolDownloadProgress((event) => {
      setProgressById((current) => ({ ...current, [event.toolId]: event }));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // 拖入 exe 登记为自定义工具。ToolManagerPage 挂载期间独占窗口拖放事件,
  // 不与其它页面冲突。
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "leave") {
          setDropActive(false);
          return;
        }
        setDropActive(true);
        if (event.payload.type === "drop") {
          setDropActive(false);
          void addDroppedExes(event.payload.paths);
        }
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  async function persistCustomTools(next: CustomTool[]) {
    const store = useApp.getState();
    const current = store.settings;
    if (!current) return;
    await store.saveSettings({ ...current, custom_tools: next });
  }

  async function addExePaths(paths: string[]): Promise<number> {
    const store = useApp.getState();
    const current = store.settings;
    if (!current) return 0;
    const exes = paths.filter((p) => p.toLowerCase().endsWith(".exe"));
    if (exes.length === 0) {
      setNotice({ tone: "warning", text: "只能添加 .exe 文件" });
      return 0;
    }
    const existing = new Set(
      current.custom_tools.map((t) => t.exe_path.replace(/\//g, "\\").toLowerCase()),
    );
    const added: CustomTool[] = [];
    for (const raw of exes) {
      const path = raw.replace(/\//g, "\\");
      const key = path.toLowerCase();
      if (existing.has(key)) continue;
      existing.add(key);
      added.push({
        id: `custom-${Date.now()}-${added.length}`,
        name: baseName(path).replace(/\.exe$/i, "") || "自定义工具",
        exe_path: path,
      });
    }
    if (added.length === 0) {
      setNotice({ tone: "warning", text: "该程序已在列表中" });
      return 0;
    }
    await store.saveSettings({
      ...current,
      custom_tools: [...current.custom_tools, ...added],
    });
    return added.length;
  }

  async function addDroppedExes(paths: string[]) {
    const count = await addExePaths(paths);
    if (count > 0) {
      setSelectedGroup(CUSTOM_GROUP);
      setNotice({ tone: "success", text: `已添加 ${count} 个自定义工具` });
    }
  }

  async function pickCustomTool() {
    const picked = await openDialog({
      multiple: true,
      title: "选择可执行文件",
      filters: [{ name: "可执行文件", extensions: ["exe"] }],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    const count = await addExePaths(paths);
    if (count > 0) {
      setNotice({ tone: "success", text: `已添加 ${count} 个自定义工具` });
    }
  }

  async function openCustom(tool: CustomTool) {
    try {
      const status = await tauri.customToolOpen(tool.exe_path);
      setNotice(
        status === "focused"
          ? { tone: "success", text: `已切换到正在运行的「${tool.name}」` }
          : status === "running"
            ? { tone: "warning", text: `「${tool.name}」已在运行` }
            : { tone: "success", text: `已启动「${tool.name}」` },
      );
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  }

  async function openCustomDir(tool: CustomTool) {
    try {
      await tauri.customToolOpenDir(tool.exe_path);
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  }

  async function renameCustom(tool: CustomTool, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === tool.name) return;
    const next = customTools.map((t) =>
      t.id === tool.id ? { ...t, name: trimmed } : t,
    );
    try {
      await persistCustomTools(next);
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  }

  async function removeCustom(tool: CustomTool) {
    const ok = await confirm(
      `确定移除「${tool.name}」?仅从列表中删除快捷方式,不会删除硬盘上的程序文件。`,
      { title: "移除自定义工具", kind: "warning" },
    );
    if (!ok) return;
    try {
      await persistCustomTools(customTools.filter((t) => t.id !== tool.id));
      setNotice({ tone: "success", text: `已移除「${tool.name}」` });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  }

  async function load() {
    setLoading(true);
    try {
      const list = await tauri.toolList();
      setTools(list);
      setNotice(null);
      // 后台逐个检查更新
      list.forEach((tool) => void checkUpdates(tool.id));
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setLoading(false);
    }
  }

  async function checkUpdates(toolId: string) {
    setCheckingIds((ids) => (ids.includes(toolId) ? ids : [...ids, toolId]));
    try {
      const info = await tauri.toolCheckUpdates(toolId);
      setTools((current) =>
        current.map((tool) =>
          tool.id === toolId
            ? {
                ...tool,
                hasUpdate: info.hasUpdate,
                latestVersion: info.latestVersion,
                changelog: info.changelog,
              }
            : tool,
        ),
      );
    } catch {
      // 更新检查失败静默处理,不影响打开操作
    } finally {
      setCheckingIds((ids) => ids.filter((id) => id !== toolId));
    }
  }

  function mergeItem(updated: ToolListItem) {
    setTools((current) =>
      current.map((tool) => (tool.id === updated.id ? updated : tool)),
    );
  }

  async function install(toolId: string, kind: "download" | "update") {
    if (downloadingRef.current.has(toolId)) return;
    downloadingRef.current.add(toolId);
    setBusyIds((ids) => [...ids, toolId]);
    setProgressById((current) => ({
      ...current,
      [toolId]: { toolId, downloaded: 0, total: 0, percent: 0 },
    }));
    try {
      const updated =
        kind === "download"
          ? await tauri.toolDownload(toolId)
          : await tauri.toolUpdate(toolId);
      mergeItem(updated);
      await checkUpdates(toolId);
      setNotice({
        tone: "success",
        text:
          kind === "download" ? "下载完成" : "已更新到最新版本",
      });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      downloadingRef.current.delete(toolId);
      setBusyIds((ids) => ids.filter((id) => id !== toolId));
      setProgressById((current) => {
        const next = { ...current };
        delete next[toolId];
        return next;
      });
    }
  }

  async function launch(toolId: string) {
    try {
      await tauri.toolLaunch(toolId);
      setNotice(null);
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  }

  async function openDir(toolId: string) {
    try {
      await tauri.toolOpenDir(toolId);
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  }

  async function restartElevated() {
    setRestarting(true);
    try {
      const restarted = await tauri.toolRestartElevated();
      if (!restarted) {
        setNotice({ tone: "warning", text: "已是管理员权限运行,无需重启" });
        setIsElevated(true);
      }
      // 若重启了则当前进程退出,后续代码不会执行
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setRestarting(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg text-fg">
      <AppHeader
        title="工具管理"
        subtitle="下载、更新和打开常用外部便携工具"
        badge={
          isElevated ? (
            <span className="inline-flex items-center gap-1 rounded bg-success/10 px-2 py-0.5 text-xs text-success">
              <ShieldCheck className="h-3 w-3" />
              管理员
            </span>
          ) : undefined
        }
        onOpenSettings={onOpenSettings}
        rightActions={
          <>
            {!isElevated && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void restartElevated()}
                disabled={restarting}
                title="以管理员身份重启本应用,重启后打开需管理员的工具不再弹 UAC"
              >
                {restarting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                管理员重启
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="h-3.5 w-3.5" />
              刷新
            </Button>
          </>
        }
      />

      {notice && (
        <div
          className={cn(
            "border-b px-5 py-2 text-sm",
            notice.tone === "success" && "border-success/20 bg-success/5 text-success",
            notice.tone === "warning" && "border-warning/20 bg-warning/5 text-warning",
            notice.tone === "error" && "border-danger/20 bg-danger/5 text-danger",
          )}
        >
          {notice.text}
        </div>
      )}

      {!isElevated && (
        <div className="border-b border-warning/20 bg-warning/5 px-5 py-2 text-xs text-warning">
          当前为普通权限,打开需要管理员的工具(如 Geek)时会弹 UAC。点击右上角「管理员重启」后,本会话内不再弹窗。
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-fg-muted">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          正在加载工具列表...
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border bg-bg px-4 py-2">
            <GroupTab
              label="全部"
              count={countFor("all")}
              active={selectedGroup === "all"}
              onClick={() => setSelectedGroup("all")}
            />
            {groups.map((g) => (
              <GroupTab
                key={g.id}
                label={g.name}
                count={countFor(g.id)}
                active={selectedGroup === g.id}
                onClick={() => setSelectedGroup(g.id)}
              />
            ))}
            <GroupTab
              label="自定义工具"
              count={countFor(CUSTOM_GROUP)}
              active={selectedGroup === CUSTOM_GROUP}
              onClick={() => setSelectedGroup(CUSTOM_GROUP)}
            />
          </div>

          {selectedGroup === CUSTOM_GROUP ? (
            <CustomToolsSection
              tools={customTools}
              dropActive={dropActive}
              onAdd={() => void pickCustomTool()}
              onOpen={(t) => void openCustom(t)}
              onOpenDir={(t) => void openCustomDir(t)}
              onRename={(t, name) => void renameCustom(t, name)}
              onRemove={(t) => void removeCustom(t)}
            />
          ) : (
            <main className="flex-1 overflow-auto p-8">
              <div className="mx-auto flex max-w-3xl flex-col gap-5">
                {visibleTools.map((tool) => (
                  <ToolCard
                    key={tool.id}
                    tool={tool}
                    checking={checkingIds.includes(tool.id)}
                    busy={busyIds.includes(tool.id)}
                    progress={progressById[tool.id] ?? null}
                    onDownload={() => void install(tool.id, "download")}
                    onUpdate={() => void install(tool.id, "update")}
                    onLaunch={() => void launch(tool.id)}
                    onOpenDir={() => void openDir(tool.id)}
                    onHomepage={() => void openUrl(tool.homepage)}
                  />
                ))}
                {visibleTools.length === 0 && (
                  <div className="py-12 text-center text-sm text-fg-muted">
                    该分组下暂无工具
                  </div>
                )}
              </div>
            </main>
          )}
        </>
      )}
    </div>
  );
}

interface ToolCardProps {
  tool: ToolListItem;
  checking: boolean;
  busy: boolean;
  progress: ToolDownloadProgress | null;
  onDownload: () => void;
  onUpdate: () => void;
  onLaunch: () => void;
  onOpenDir: () => void;
  onHomepage: () => void;
}

function ToolCard({
  tool,
  checking,
  busy,
  progress,
  onDownload,
  onUpdate,
  onLaunch,
  onOpenDir,
  onHomepage,
}: ToolCardProps) {
  const [changelogOpen, setChangelogOpen] = useState(false);
  const installed = tool.installed;
  const showUpdate = installed && tool.hasUpdate;
  const checkingVersion = checking && !tool.latestVersion;
  const changelogId = `changelog-${tool.id}`;

  return (
    <section className="rounded-2xl border border-border bg-bg-subtle p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Package className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-fg">{tool.name}</h2>
            {showUpdate ? (
              <StatusBadge tone="warning" text={`有更新 ${tool.latestVersion}`} />
            ) : installed ? (
              <StatusBadge tone="success" text={`已安装 ${tool.version}`} />
            ) : (
              <StatusBadge tone="muted" text="未下载" />
            )}
            {checkingVersion && (
              <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                <Loader2 className="h-3 w-3 animate-spin" />
                检查更新中
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            {tool.description ||
              "便携版,下载后存放在本应用数据目录,双击卡片即可打开。"}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onHomepage} title="访问官网">
          <ExternalLink className="h-3.5 w-3.5" />
          主页
        </Button>
      </div>

      {busy && progress ? (
        <div className="mt-5">
          <div className="mb-1 flex items-center justify-between text-xs text-fg-muted">
            <span>下载中...</span>
            <span>{progress.percent}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-bg-muted">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {!installed ? (
            <Button variant="primary" size="sm" onClick={onDownload} disabled={busy}>
              <Download className="h-3.5 w-3.5" />
              下载
            </Button>
          ) : (
            <>
              <Button variant="primary" size="sm" onClick={onLaunch} disabled={busy}>
                <Play className="h-3.5 w-3.5" />
                打开
              </Button>
              <Button variant="outline" size="sm" onClick={onOpenDir} disabled={busy}>
                <FolderOpen className="h-3.5 w-3.5" />
                打开目录
              </Button>
              {showUpdate && (
                <Button variant="outline" size="sm" onClick={onUpdate} disabled={busy}>
                  <Download className="h-3.5 w-3.5" />
                  更新
                </Button>
              )}
            </>
          )}
          {installed && !showUpdate && !checkingVersion && (
            <span className="text-xs text-fg-muted">已是最新版本</span>
          )}
        </div>
      )}

      {showUpdate && tool.changelog.length > 0 && (
        <div className="mt-4 rounded-lg border border-border bg-bg">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-fg-muted hover:text-fg"
            onClick={() => setChangelogOpen((open) => !open)}
            title={changelogOpen ? "收起更新内容" : "展开更新内容"}
            aria-expanded={changelogOpen}
            aria-controls={changelogId}
          >
            {changelogOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            更新内容
            <span className="font-normal">({tool.changelog.length} 条)</span>
          </button>
          {changelogOpen && (
            <ul
              id={changelogId}
              className="list-disc space-y-1 border-t border-border py-2 pl-8 pr-3 text-sm text-fg"
            >
              {tool.changelog.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function StatusBadge({ tone, text }: { tone: "success" | "warning" | "muted"; text: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded px-1.5 text-[11px] font-medium",
        tone === "success" && "bg-success/10 text-success",
        tone === "warning" && "bg-warning/10 text-warning",
        tone === "muted" && "bg-bg-muted text-fg-muted",
      )}
    >
      {text}
    </span>
  );
}

interface GroupTabProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

function GroupTab({ label, count, active, onClick }: GroupTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-accent/10 text-accent"
          : "text-fg-muted hover:bg-bg-muted hover:text-fg",
      )}
    >
      {label}
      <span className="text-[10px] font-normal opacity-60">{count}</span>
    </button>
  );
}

interface CustomToolsSectionProps {
  tools: CustomTool[];
  dropActive: boolean;
  onAdd: () => void;
  onOpen: (tool: CustomTool) => void;
  onOpenDir: (tool: CustomTool) => void;
  onRename: (tool: CustomTool, name: string) => void;
  onRemove: (tool: CustomTool) => void;
}

function CustomToolsSection({
  tools,
  dropActive,
  onAdd,
  onOpen,
  onOpenDir,
  onRename,
  onRemove,
}: CustomToolsSectionProps) {
  return (
    <main className="relative flex-1 overflow-auto p-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div className="flex items-center justify-between">
          <p className="text-xs text-fg-muted">
            拖入或添加本机 .exe,快捷打开;已在运行时切换到已打开的窗口。仅登记快捷方式,不复制程序文件。
          </p>
          <Button variant="primary" size="sm" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" />
            添加
          </Button>
        </div>

        {tools.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center text-sm text-fg-muted">
            <AppWindow className="h-8 w-8 opacity-50" />
            <div>把 exe 文件拖到这里,或点击右上角「添加」</div>
          </div>
        ) : (
          tools.map((tool) => (
            <CustomToolCard
              key={tool.id}
              tool={tool}
              onOpen={() => onOpen(tool)}
              onOpenDir={() => onOpenDir(tool)}
              onRename={(name) => onRename(tool, name)}
              onRemove={() => onRemove(tool)}
            />
          ))
        )}
      </div>

      {dropActive && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center border-2 border-dashed border-accent bg-accent/5 text-sm font-medium text-accent">
          松开以添加 .exe
        </div>
      )}
    </main>
  );
}

interface CustomToolCardProps {
  tool: CustomTool;
  onOpen: () => void;
  onOpenDir: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}

function CustomToolCard({
  tool,
  onOpen,
  onOpenDir,
  onRename,
  onRemove,
}: CustomToolCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tool.name);

  function commit() {
    setEditing(false);
    onRename(draft);
  }

  return (
    <section className="rounded-2xl border border-border bg-bg-subtle p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <AppWindow className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") {
                  setDraft(tool.name);
                  setEditing(false);
                }
              }}
              className="w-full max-w-xs rounded border border-border bg-bg px-2 py-1 text-lg font-semibold text-fg outline-none focus:border-accent"
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <h2 className="truncate text-lg font-semibold text-fg">{tool.name}</h2>
              <button
                type="button"
                className="text-fg-muted hover:text-fg"
                title="重命名"
                onClick={() => {
                  setDraft(tool.name);
                  setEditing(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <p className="mt-1 truncate text-xs text-fg-muted" title={tool.exe_path}>
            {tool.exe_path}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={onOpen}>
          <Play className="h-3.5 w-3.5" />
          打开
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenDir}>
          <FolderOpen className="h-3.5 w-3.5" />
          打开目录
        </Button>
        <Button variant="ghost" size="sm" onClick={onRemove} title="从列表移除">
          <Trash2 className="h-3.5 w-3.5" />
          移除
        </Button>
      </div>
    </section>
  );
}
