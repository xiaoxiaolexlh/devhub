import { useEffect, useMemo, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  Loader2,
  Play,
  Plus,
  RefreshCcw,
  Save,
  Settings,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";
import {
  tauri,
  type CleanerAction,
  type CleanerCleanResult,
  type CleanerConfig,
  type CleanerDirectoryEntry,
  type CleanerPathPreview,
  type CleanerProfile,
} from "@/lib/tauri";
import { useApp } from "@/stores/app";

interface Props {
  onOpenSettings: () => void;
}

type Notice = { tone: "success" | "warning" | "error"; text: string } | null;

const EMPTY_CONFIG: CleanerConfig = { profiles: {} };
const ACTIONS: CleanerAction[] = ["clear", "remove"];

export function DirectoryCleanerPage({ onOpenSettings }: Props) {
  const { setAppMode } = useApp();
  const [configPath, setConfigPath] = useState("");
  const [config, setConfig] = useState<CleanerConfig>(EMPTY_CONFIG);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [action, setAction] = useState<CleanerAction>("clear");
  const [previews, setPreviews] = useState<CleanerPathPreview[]>([]);
  const [results, setResults] = useState<CleanerCleanResult[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const profileKeys = useMemo(() => Object.keys(config.profiles).sort(), [config]);
  const selectedProfile = selectedKey ? config.profiles[selectedKey] : undefined;

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setKeyDraft(selectedKey ?? "");
  }, [selectedKey]);

  useEffect(() => {
    if (!selectedProfile) return;
    if (!selectedProfile.allowedActions.includes(action)) {
      setAction(selectedProfile.defaultAction);
    }
  }, [action, selectedProfile]);

  async function load() {
    setLoading(true);
    try {
      const payload = await tauri.cleanerLoadConfig();
      applyPayload(payload.configPath, payload.config);
      setNotice(null);
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setLoading(false);
    }
  }

  function applyPayload(path: string, nextConfig: CleanerConfig, preferredKey?: string | null) {
    const keys = Object.keys(nextConfig.profiles).sort();
    const nextSelected =
      preferredKey && nextConfig.profiles[preferredKey] ? preferredKey : keys[0] ?? null;
    setConfigPath(path);
    setConfig(nextConfig);
    setSelectedKey(nextSelected);
    setAction(nextSelected ? nextConfig.profiles[nextSelected].defaultAction : "clear");
    setPreviews([]);
    setResults([]);
    setDirty(false);
  }

  function markDirty() {
    setDirty(true);
    setPreviews([]);
    setResults([]);
  }

  function updateSelectedProfile(updater: (profile: CleanerProfile) => CleanerProfile) {
    if (!selectedKey || !selectedProfile) return;
    setConfig((current) => ({
      profiles: {
        ...current.profiles,
        [selectedKey]: updater(current.profiles[selectedKey]),
      },
    }));
    markDirty();
  }

  function addProfile() {
    const suggested = nextProfileKey(profileKeys);
    const key = window.prompt("Profile key", suggested)?.trim();
    if (!key) return;
    if (config.profiles[key]) {
      setNotice({ tone: "error", text: `Profile 已存在: ${key}` });
      return;
    }
    const profile: CleanerProfile = {
      description: "",
      allowedActions: ["clear"],
      defaultAction: "clear",
      directories: [],
    };
    setConfig((current) => ({
      profiles: { ...current.profiles, [key]: profile },
    }));
    setSelectedKey(key);
    setAction("clear");
    markDirty();
  }

  function deleteProfile() {
    if (!selectedKey) return;
    if (!window.confirm(`删除 profile "${selectedKey}"?`)) return;
    const nextProfiles = { ...config.profiles };
    delete nextProfiles[selectedKey];
    const nextKeys = Object.keys(nextProfiles).sort();
    setConfig({ profiles: nextProfiles });
    setSelectedKey(nextKeys[0] ?? null);
    markDirty();
  }

  function commitProfileKey() {
    if (!selectedKey) return;
    const nextKey = keyDraft.trim();
    if (!nextKey) {
      setKeyDraft(selectedKey);
      setNotice({ tone: "error", text: "Profile key 不能为空" });
      return;
    }
    if (nextKey === selectedKey) return;
    if (config.profiles[nextKey]) {
      setKeyDraft(selectedKey);
      setNotice({ tone: "error", text: `Profile 已存在: ${nextKey}` });
      return;
    }
    const nextProfiles = { ...config.profiles };
    nextProfiles[nextKey] = nextProfiles[selectedKey];
    delete nextProfiles[selectedKey];
    setConfig({ profiles: nextProfiles });
    setSelectedKey(nextKey);
    markDirty();
  }

  function toggleAllowedAction(nextAction: CleanerAction) {
    updateSelectedProfile((profile) => {
      const exists = profile.allowedActions.includes(nextAction);
      if (exists && profile.allowedActions.length === 1) return profile;
      const allowedActions = exists
        ? profile.allowedActions.filter((item) => item !== nextAction)
        : [...profile.allowedActions, nextAction].sort(actionSort);
      const defaultAction = allowedActions.includes(profile.defaultAction)
        ? profile.defaultAction
        : allowedActions[0];
      if (!allowedActions.includes(action)) {
        setAction(defaultAction);
      }
      return { ...profile, allowedActions, defaultAction };
    });
  }

  function updateDirectory(index: number, patch: Partial<CleanerDirectoryEntry>) {
    updateSelectedProfile((profile) => ({
      ...profile,
      directories: profile.directories.map((entry, itemIndex) =>
        itemIndex === index ? { ...entry, ...patch } : entry,
      ),
    }));
  }

  function addDirectory() {
    updateSelectedProfile((profile) => ({
      ...profile,
      directories: [...profile.directories, { label: "", path: "" }],
    }));
  }

  function removeDirectory(index: number) {
    updateSelectedProfile((profile) => ({
      ...profile,
      directories: profile.directories.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  async function saveConfig() {
    setWorking(true);
    try {
      const payload = await tauri.cleanerSaveConfig(config);
      applyPayload(payload.configPath, payload.config, selectedKey);
      setNotice({ tone: "success", text: "配置已保存" });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setWorking(false);
    }
  }

  async function importConfig() {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
      title: "导入 cleaner.config.json",
    });
    if (!selected || typeof selected !== "string") return;
    setWorking(true);
    try {
      const payload = await tauri.cleanerImportConfig(selected);
      applyPayload(payload.configPath, payload.config);
      setNotice({ tone: "success", text: "配置已导入并规范化保存" });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setWorking(false);
    }
  }

  async function exportConfig() {
    const destination = await saveDialog({
      defaultPath: "cleaner.config.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
      title: "导出 cleaner.config.json",
    });
    if (!destination) return;
    setWorking(true);
    try {
      await tauri.cleanerExportConfig(destination);
      setNotice({ tone: "success", text: "配置已导出" });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setWorking(false);
    }
  }

  async function preview() {
    if (!selectedKey) return;
    if (dirty) {
      setNotice({ tone: "warning", text: "请先保存配置，再预览或执行清理" });
      return;
    }
    setWorking(true);
    try {
      const nextPreviews = await tauri.cleanerPreviewProfile(selectedKey, action);
      setPreviews(nextPreviews);
      setResults([]);
      setNotice(null);
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setWorking(false);
    }
  }

  async function execute() {
    if (!selectedKey) return;
    setConfirmOpen(false);
    setWorking(true);
    try {
      const nextResults = await tauri.cleanerExecuteProfile(selectedKey, action);
      setResults(nextResults);
      const nextPreviews = await tauri.cleanerPreviewProfile(selectedKey, action);
      setPreviews(nextPreviews);
      setNotice({ tone: "success", text: "清理执行完成" });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setWorking(false);
    }
  }

  const canPreview =
    Boolean(selectedKey) &&
    (selectedProfile?.directories.length ?? 0) > 0 &&
    Boolean(selectedProfile?.allowedActions.includes(action)) &&
    !working;
  const hasPreviewErrors = previews.some((item) => item.status === "error");
  const canExecute = canPreview && !dirty && previews.length > 0 && !hasPreviewErrors;
  const readyCount = previews.filter((item) => item.status === "ready").length;
  const missingCount = previews.filter((item) => item.status === "missing").length;
  const resultSuccess = results.filter((item) => item.status === "success").length;
  const resultSkipped = results.filter((item) => item.status === "skipped").length;
  const resultFailed = results.filter((item) => item.status === "error").length;

  return (
    <div className="flex h-full w-full flex-col bg-bg text-fg">
      <div className="flex items-center gap-3 border-b border-border bg-bg px-4 py-2">
        <Button variant="ghost" size="sm" onClick={() => setAppMode("home")}>
          <ArrowLeft className="h-3.5 w-3.5" />
          模式
        </Button>
        <div>
          <div className="text-sm font-semibold text-fg">目录清理</div>
          <div className="max-w-[48vw] truncate font-mono text-xs text-fg-muted">
            {configPath || "加载配置路径..."}
          </div>
        </div>
        {dirty && (
          <span className="rounded bg-warning/10 px-2 py-0.5 text-xs text-warning">
            未保存
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={importConfig} disabled={working}>
            <Upload className="h-3.5 w-3.5" />
            导入
          </Button>
          <Button variant="outline" size="sm" onClick={exportConfig} disabled={working}>
            <Download className="h-3.5 w-3.5" />
            导出
          </Button>
          <Button variant="primary" size="sm" onClick={saveConfig} disabled={working || !dirty}>
            <Save className="h-3.5 w-3.5" />
            保存
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpenSettings}>
            <Settings className="h-3.5 w-3.5" />
            设置
          </Button>
        </div>
      </div>

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

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-fg-muted">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          正在加载目录清理配置...
        </div>
      ) : (
        <main className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_360px]">
          <aside className="flex min-h-0 flex-col border-r border-border bg-bg-subtle">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <div className="text-sm font-semibold">Profiles</div>
                <div className="text-xs text-fg-muted">{profileKeys.length} 个清理配置</div>
              </div>
              <Button variant="outline" size="icon" onClick={addProfile} title="新增 Profile">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {profileKeys.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-fg-muted">
                  还没有 profile
                </div>
              ) : (
                profileKeys.map((key) => {
                  const profile = config.profiles[key];
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        setSelectedKey(key);
                        setAction(profile.defaultAction);
                        setPreviews([]);
                        setResults([]);
                      }}
                      className={cn(
                        "mb-2 w-full rounded-lg border px-3 py-2 text-left transition",
                        selectedKey === key
                          ? "border-accent bg-accent/10"
                          : "border-border bg-bg hover:bg-bg-muted",
                      )}
                    >
                      <div className="font-mono text-sm font-semibold text-fg">{key}</div>
                      <div className="mt-1 truncate text-xs text-fg-muted">
                        {profile.description || "无描述"}
                      </div>
                      <div className="mt-2 text-xs text-fg-subtle">
                        {profile.directories.length} 个目标
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <section className="min-h-0 overflow-auto p-5">
            {!selectedProfile ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-fg-muted">
                新增或导入配置后开始编辑
              </div>
            ) : (
              <div className="mx-auto flex max-w-5xl flex-col gap-5">
                <Panel
                  title="Profile"
                  desc="Key 用于执行和导入后的识别，保存时会写入 cleaner.config.json"
                >
                  <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
                    <Field label="Key">
                      <Input
                        value={keyDraft}
                        onChange={(event) => setKeyDraft(event.target.value)}
                        onBlur={commitProfileKey}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                          }
                        }}
                        className="font-mono"
                      />
                    </Field>
                    <Field label="Description">
                      <Input
                        value={selectedProfile.description}
                        onChange={(event) =>
                          updateSelectedProfile((profile) => ({
                            ...profile,
                            description: event.target.value,
                          }))
                        }
                        placeholder="例如: 清理 WindSurf"
                      />
                    </Field>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-5">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-medium text-fg-muted">允许动作</span>
                      {ACTIONS.map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => toggleAllowedAction(item)}
                          className="inline-flex items-center gap-2 text-sm"
                        >
                          <Checkbox checked={selectedProfile.allowedActions.includes(item)} />
                          {actionLabel(item)}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-fg-muted">默认动作</span>
                      <Select
                        value={selectedProfile.defaultAction}
                        onChange={(event) =>
                          updateSelectedProfile((profile) => ({
                            ...profile,
                            defaultAction: event.target.value as CleanerAction,
                          }))
                        }
                      >
                        {selectedProfile.allowedActions.map((item) => (
                          <option key={item} value={item}>
                            {actionLabel(item)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={deleteProfile}
                      className="ml-auto text-danger hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      删除 Profile
                    </Button>
                  </div>
                </Panel>

                <Panel
                  title="清理目标"
                  desc="相对路径会按 %APPDATA%\\com.xiaoxiaol123456.devhub\\cleaner 解析；保存时空路径会被后端丢弃"
                  action={
                    <Button variant="outline" size="sm" onClick={addDirectory}>
                      <Plus className="h-3.5 w-3.5" />
                      新增目录
                    </Button>
                  }
                >
                  <div className="overflow-hidden rounded-lg border border-border bg-bg">
                    <div className="grid grid-cols-[180px_minmax(0,1fr)_72px] border-b border-border bg-bg-muted px-3 py-2 text-xs font-medium text-fg-muted">
                      <span>Label</span>
                      <span>Path</span>
                      <span className="text-right">操作</span>
                    </div>
                    {selectedProfile.directories.length === 0 ? (
                      <div className="px-3 py-8 text-center text-xs text-fg-muted">
                        还没有清理目标
                      </div>
                    ) : (
                      selectedProfile.directories.map((entry, index) => (
                        <div
                          key={index}
                          className="grid grid-cols-[180px_minmax(0,1fr)_72px] gap-2 border-b border-border px-3 py-2 last:border-b-0"
                        >
                          <Input
                            value={entry.label}
                            onChange={(event) =>
                              updateDirectory(index, { label: event.target.value })
                            }
                            placeholder="可选"
                            className="text-xs"
                          />
                          <Input
                            value={entry.path}
                            onChange={(event) =>
                              updateDirectory(index, { path: event.target.value })
                            }
                            placeholder="C:\\Users\\... 或 caches\\abc"
                            className={cn("font-mono text-xs", !entry.path.trim() && "border-danger")}
                          />
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeDirectory(index)}
                              title="删除目标"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Panel>
              </div>
            )}
          </section>

          <aside className="flex min-h-0 flex-col border-l border-border bg-bg-subtle">
            <div className="border-b border-border px-4 py-3">
              <div className="text-sm font-semibold">预览与执行</div>
              <div className="text-xs text-fg-muted">永久删除，不进入回收站</div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
              <Panel title="动作">
                <div className="flex items-center gap-2">
                  <Select
                    value={action}
                    onChange={(event) => setAction(event.target.value as CleanerAction)}
                    className="w-full"
                    disabled={!selectedProfile}
                  >
                    {(selectedProfile?.allowedActions ?? ACTIONS).map((item) => (
                      <option key={item} value={item}>
                        {actionLabel(item)}
                      </option>
                    ))}
                  </Select>
                  <Button variant="outline" size="icon" onClick={preview} disabled={!canPreview}>
                    {working ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCcw className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {dirty && (
                  <div className="mt-2 text-xs text-warning">保存配置后才能预览和执行</div>
                )}
              </Panel>

              <Panel title="目标状态" desc={`ready ${readyCount} · missing ${missingCount}`}>
                <PreviewList previews={previews} />
              </Panel>

              {results.length > 0 && (
                <Panel
                  title="结果"
                  desc={`成功 ${resultSuccess} · 跳过 ${resultSkipped} · 失败 ${resultFailed}`}
                >
                  <ResultList results={results} />
                </Panel>
              )}
            </div>
            <div className="border-t border-border p-4">
              <Button
                variant="danger"
                size="md"
                className="w-full"
                disabled={!canExecute || working}
                onClick={() => setConfirmOpen(true)}
              >
                <Play className="h-4 w-4" />
                执行清理
              </Button>
              {hasPreviewErrors && (
                <div className="mt-2 text-xs text-danger">预览存在错误项，不能执行</div>
              )}
            </div>
          </aside>
        </main>
      )}

      <ConfirmCleanDialog
        open={confirmOpen}
        profileKey={selectedKey ?? ""}
        profile={selectedProfile}
        action={action}
        previews={previews}
        working={working}
        onClose={() => setConfirmOpen(false)}
        onConfirm={execute}
      />
    </div>
  );
}

function Panel({
  title,
  desc,
  action,
  children,
}: {
  title: string;
  desc?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-bg-subtle p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {desc && <p className="text-xs text-fg-muted">{desc}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

function PreviewList({ previews }: { previews: CleanerPathPreview[] }) {
  if (previews.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-fg-muted">
        保存后点击预览
      </div>
    );
  }
  return (
    <div className="max-h-80 overflow-auto rounded-lg border border-border bg-bg">
      {previews.map((item, index) => (
        <div key={`${item.absolutePath}-${index}`} className="border-b border-border px-3 py-2 last:border-b-0">
          <div className="flex items-center gap-2">
            <StatusBadge status={item.status} />
            <span className="min-w-0 flex-1 truncate text-sm text-fg">
              {item.label || item.path}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-fg-subtle">
            {item.absolutePath}
          </div>
          <div className="mt-1 text-xs text-fg-muted">{item.message}</div>
        </div>
      ))}
    </div>
  );
}

function ResultList({ results }: { results: CleanerCleanResult[] }) {
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-border bg-bg">
      {results.map((item, index) => (
        <div key={`${item.absolutePath}-${index}`} className="border-b border-border px-3 py-2 last:border-b-0">
          <div className="flex items-center gap-2">
            <StatusBadge status={item.status} />
            <span className="min-w-0 flex-1 truncate text-sm text-fg">
              {item.label || item.path}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-fg-subtle">
            {item.absolutePath}
          </div>
          <div className="mt-1 text-xs text-fg-muted">{item.message}</div>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "success" || status === "ready"
      ? "success"
      : status === "missing" || status === "skipped"
        ? "warning"
        : "danger";
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[11px] font-medium",
        tone === "success" && "bg-success/10 text-success",
        tone === "warning" && "bg-warning/10 text-warning",
        tone === "danger" && "bg-danger/10 text-danger",
      )}
    >
      {status}
    </span>
  );
}

function ConfirmCleanDialog({
  open,
  profileKey,
  profile,
  action,
  previews,
  working,
  onClose,
  onConfirm,
}: {
  open: boolean;
  profileKey: string;
  profile: CleanerProfile | undefined;
  action: CleanerAction;
  previews: CleanerPathPreview[];
  working: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !working && onClose()}>
      <DialogContent width="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <ShieldAlert className="h-5 w-5 text-danger" />
            确认执行目录清理
          </DialogTitle>
          <DialogDescription className="text-xs text-fg-muted">
            将执行 {actionLabel(action)}，删除内容不会进入回收站。
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  永久删除，不可从回收站恢复。请确认下面的绝对路径全部正确。
                </div>
              </div>
            </div>
            <div className="grid gap-2 text-sm md:grid-cols-3">
              <SummaryItem label="Profile" value={profileKey} />
              <SummaryItem label="Description" value={profile?.description || "无描述"} />
              <SummaryItem label="Action" value={`${action} · ${actionDescription(action)}`} />
            </div>
            <div className="max-h-72 overflow-auto rounded-lg border border-border bg-bg">
              {previews.map((item, index) => (
                <div key={`${item.absolutePath}-${index}`} className="border-b border-border px-3 py-2 last:border-b-0">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={item.status} />
                    <span className="text-sm text-fg">{item.label || item.path}</span>
                  </div>
                  <div className="mt-1 break-all font-mono text-[11px] text-fg-muted">
                    {item.absolutePath}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={working}>
            取消
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={working}>
            {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            确认永久清理
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-subtle px-3 py-2">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-fg">{value}</div>
    </div>
  );
}

function nextProfileKey(keys: string[]) {
  let index = 1;
  while (keys.includes(`profile${index}`)) {
    index += 1;
  }
  return `profile${index}`;
}

function actionSort(a: CleanerAction, b: CleanerAction) {
  return ACTIONS.indexOf(a) - ACTIONS.indexOf(b);
}

function actionLabel(action: CleanerAction) {
  return action === "clear" ? "clear 清空目录" : "remove 删除目标";
}

function actionDescription(action: CleanerAction) {
  return action === "clear" ? "保留目录本身，删除第一层内容" : "删除文件或整个目录";
}
