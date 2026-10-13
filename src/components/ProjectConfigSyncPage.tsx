import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";
import { tauri, type ConflictStrategy, type ProjectConfigEntry, type ProjectConfigResultItem } from "@/lib/tauri";
import { useApp } from "@/stores/app";
import { OpenWithButton } from "@/components/OpenWithButton";
import { AppHeader } from "@/components/AppHeader";
import { Folder, FolderOpen, Loader2, Puzzle, RefreshCcw, Trash2 } from "lucide-react";

interface Props {
  onOpenSettings: () => void;
}

interface PlannedTask {
  sourceProjectDir: string;
  targetProjectDir: string;
  configDirName: string;
  conflict: boolean;
}

type Phase = "preview" | "running" | "done";

export function ProjectConfigSyncPage({ onOpenSettings }: Props) {
  const {
    settings,
    recentProjectRoots,
    setAppMode,
    addRecentProjectRoot,
    removeRecentProjectRoot,
  } = useApp();
  const [sourceDir, setSourceDir] = useState("");
  const [targetDirs, setTargetDirs] = useState<string[]>([]);
  const [sourceEntries, setSourceEntries] = useState<ProjectConfigEntry[]>([]);
  const [targetEntries, setTargetEntries] = useState<Record<string, ProjectConfigEntry[]>>({});
  const [targetErrors, setTargetErrors] = useState<Record<string, string>>({});
  const [selectedDirs, setSelectedDirs] = useState<Set<string>>(new Set());
  const [scanError, setScanError] = useState<string | null>(null);
  const [loadingSource, setLoadingSource] = useState(false);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [phase, setPhase] = useState<Phase>("preview");
  const [results, setResults] = useState<ProjectConfigResultItem[]>([]);
  const [working, setWorking] = useState(false);

  const configDirs = useMemo(
    () => settings?.project_config_dirs.filter((d) => d.trim()) ?? [],
    [settings],
  );
  const initialStrategy: ConflictStrategy = settings?.conflict_strategy === "skip" ? "skip" : "overwrite";
  const [strategy, setStrategy] = useState<ConflictStrategy>(initialStrategy);

  useEffect(() => {
    setStrategy(initialStrategy);
  }, [initialStrategy]);

  useEffect(() => {
    if (!sourceDir || configDirs.length === 0) {
      setSourceEntries([]);
      setSelectedDirs(new Set());
      setScanError(null);
      return;
    }
    let cancelled = false;
    setLoadingSource(true);
    tauri
      .scanProjectConfigDirs(sourceDir, configDirs)
      .then((entries) => {
        if (cancelled) return;
        setSourceEntries(entries);
        setSelectedDirs(new Set(entries.filter((e) => e.exists).map((e) => e.name)));
        setScanError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setSourceEntries([]);
        setSelectedDirs(new Set());
        setScanError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingSource(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceDir, configDirs]);

  useEffect(() => {
    if (targetDirs.length === 0 || configDirs.length === 0) {
      setTargetEntries({});
      setTargetErrors({});
      return;
    }
    let cancelled = false;
    setLoadingTargets(true);
    Promise.all(
      targetDirs.map((target) =>
        tauri
          .scanProjectConfigDirs(target, configDirs)
          .then((entries) => ({ target, entries, error: null as string | null }))
          .catch((e) => ({ target, entries: [] as ProjectConfigEntry[], error: String(e) })),
      ),
    )
      .then((items) => {
        if (cancelled) return;
        const nextEntries: Record<string, ProjectConfigEntry[]> = {};
        const nextErrors: Record<string, string> = {};
        items.forEach((item) => {
          nextEntries[item.target] = item.entries;
          if (item.error) nextErrors[item.target] = item.error;
        });
        setTargetEntries(nextEntries);
        setTargetErrors(nextErrors);
      })
      .finally(() => {
        if (!cancelled) setLoadingTargets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [targetDirs, configDirs]);

  const planned = useMemo<PlannedTask[]>(() => {
    const out: PlannedTask[] = [];
    if (!sourceDir) return out;
    for (const target of targetDirs) {
      for (const name of selectedDirs) {
        const conflict = targetEntries[target]?.some((entry) => entry.name === name && entry.exists) ?? false;
        out.push({ sourceProjectDir: sourceDir, targetProjectDir: target, configDirName: name, conflict });
      }
    }
    return out;
  }, [sourceDir, targetDirs, selectedDirs, targetEntries]);

  const knownProjects = useMemo(() => {
    const fixed = settings?.project_roots ?? [];
    return [...fixed, ...recentProjectRoots].filter((path, index, arr) => {
      const key = path.toLowerCase();
      return path.trim() && arr.findIndex((p) => p.toLowerCase() === key) === index;
    });
  }, [settings, recentProjectRoots]);

  async function pickSource() {
    const picked = await openDialog({ directory: true, multiple: false, title: "选择源项目目录" });
    if (!picked || typeof picked !== "string") return;
    setSource(picked);
  }

  async function addTargetByPicker() {
    const picked = await openDialog({ directory: true, multiple: false, title: "选择目标项目目录" });
    if (!picked || typeof picked !== "string") return;
    addTarget(picked);
  }

  function rememberOpenedPath(path: string) {
    const trimmed = path.trim();
    if (!trimmed) return;
    addRecentProjectRoot(trimmed);
  }

  function setSource(path: string) {
    setSourceDir(path);
    setTargetDirs((items) => items.filter((item) => !samePath(item, path)));
    addRecentProjectRoot(path);
    setPhase("preview");
    setResults([]);
  }

  function addTarget(path: string) {
    const trimmed = path.trim();
    if (!trimmed) return;
    if (sourceDir && samePath(sourceDir, trimmed)) return;
    setTargetDirs((items) =>
      items.some((item) => samePath(item, trimmed)) ? items : [...items, trimmed],
    );
    addRecentProjectRoot(trimmed);
    setPhase("preview");
    setResults([]);
  }

  function removeTarget(path: string) {
    setTargetDirs((items) => items.filter((item) => !samePath(item, path)));
  }

  function toggleConfig(name: string) {
    setSelectedDirs((items) => {
      const next = new Set(items);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
    setPhase("preview");
    setResults([]);
  }

  async function execute() {
    setPhase("running");
    setWorking(true);
    try {
      const tasks = planned.map((task) => ({
        source_project_dir: task.sourceProjectDir,
        target_project_dir: task.targetProjectDir,
        config_dir_name: task.configDirName,
      }));
      const nextResults = await tauri.syncProjectConfigs(tasks, strategy);
      setResults(nextResults);
      setPhase("done");
    } finally {
      setWorking(false);
    }
  }

  const conflictCount = planned.filter((task) => task.conflict).length;
  const successCount = results.filter((r) => r.success && !r.skipped).length;
  const skippedCount = results.filter((r) => r.skipped).length;
  const failedCount = results.filter((r) => !r.success).length;
  const hasTargetErrors = Object.keys(targetErrors).length > 0;
  const canExecute =
    Boolean(sourceDir) &&
    targetDirs.length > 0 &&
    selectedDirs.size > 0 &&
    planned.length > 0 &&
    !hasTargetErrors &&
    !working;

  return (
    <div className="flex h-full w-full flex-col bg-bg text-fg">
      <AppHeader
        title="项目配置同步"
        subtitle="把 .vscode、.windsurf、.cursor 等配置目录同步到其它项目"
        onOpenSettings={onOpenSettings}
        rightActions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAppMode("extensions")}
          >
            <Puzzle className="h-3.5 w-3.5" />
            扩展同步
          </Button>
        }
      />

      <main className="flex-1 overflow-auto p-5">
        <div className="mx-auto flex max-w-6xl flex-col gap-5">
          <section className="grid gap-4 lg:grid-cols-2">
            <Panel title="源项目" desc="从这个项目复制配置目录">
              <PathPicker
                value={sourceDir}
                placeholder="请选择源项目目录"
                onPick={pickSource}
                openPath={sourceDir || undefined}
                onOpened={rememberOpenedPath}
              />
              {scanError && <p className="mt-2 text-xs text-danger">{scanError}</p>}
            </Panel>
            <Panel title="目标项目" desc="可逐个添加多个目标项目">
              <div className="flex flex-col gap-2">
                <Button variant="outline" size="md" onClick={addTargetByPicker} className="self-start">
                  <FolderOpen className="h-4 w-4" />
                  添加目标项目
                </Button>
                {targetDirs.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-fg-muted">
                    还没有目标项目
                  </div>
                ) : (
                  targetDirs.map((path) => (
                    <div key={path} className="flex items-center gap-2 rounded-lg border border-border bg-bg p-2">
                      <Folder className="h-4 w-4 text-fg-subtle" />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{path}</span>
                      {targetErrors[path] && <span className="text-xs text-danger">无效</span>}
                      <OpenWithButton
                        path={path}
                        showLabel={false}
                        variant="ghost"
                        size="sm"
                        title="打开目标项目"
                        onError={(text) => setScanError(text)}
                      />
                      <Button variant="ghost" size="icon" onClick={() => removeTarget(path)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </Panel>
          </section>

          {knownProjects.length > 0 && (
            <Panel title="项目记忆" desc="固定项目和最近使用项目，可快速设为源或添加为目标">
              <div className="grid gap-2 md:grid-cols-2">
                {knownProjects.map((path) => (
                  <div key={path} className="flex items-center gap-2 rounded-lg border border-border bg-bg p-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{path}</span>
                    <Button variant="ghost" size="sm" onClick={() => setSource(path)}>设为源</Button>
                    <Button variant="outline" size="sm" onClick={() => addTarget(path)}>加目标</Button>
                    <OpenWithButton
                      path={path}
                      label="打开"
                      variant="ghost"
                      onError={(text) => setScanError(text)}
                      onSuccess={(opened) => rememberOpenedPath(opened)}
                    />
                    {recentProjectRoots.some((p) => samePath(p, path)) && (
                      <Button variant="ghost" size="icon" onClick={() => removeRecentProjectRoot(path)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel title="配置目录" desc="只会同步源项目中实际存在并被勾选的目录">
            {loadingSource ? (
              <StatusLine icon={<Loader2 className="h-4 w-4 animate-spin" />} text="正在扫描源项目..." />
            ) : sourceEntries.length === 0 ? (
              <StatusLine icon={<Folder className="h-4 w-4" />} text="选择源项目后显示可同步目录" />
            ) : (
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
                {sourceEntries.map((entry) => (
                  <div
                    key={entry.name}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border p-3 text-left transition",
                      selectedDirs.has(entry.name) ? "border-accent bg-accent/10" : "border-border bg-bg",
                      !entry.exists && "opacity-50",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => entry.exists && toggleConfig(entry.name)}
                      disabled={!entry.exists}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
                    >
                      <Checkbox checked={selectedDirs.has(entry.name)} disabled={!entry.exists} />
                      <div className="min-w-0">
                        <div className="font-mono text-sm font-semibold">{entry.name}</div>
                        <div className="text-xs text-fg-muted">{entry.exists ? "存在" : "源项目中不存在"}</div>
                      </div>
                    </button>
                    {entry.exists && (
                      <OpenWithButton
                        path={entry.path}
                        showLabel={false}
                        variant="ghost"
                        size="sm"
                        title={`打开 ${entry.name}`}
                        onError={(text) => setScanError(text)}
                        onSuccess={(opened) => rememberOpenedPath(opened)}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="执行预览" desc={`共 ${planned.length} 个任务，${conflictCount} 个目标已存在同名目录`}>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
              <span>冲突处理:</span>
              <Select value={strategy} onChange={(e) => setStrategy(e.target.value as ConflictStrategy)}>
                <option value="overwrite">覆盖已存在</option>
                <option value="skip">跳过已存在</option>
              </Select>
              {loadingTargets && <RefreshCcw className="h-4 w-4 animate-spin text-fg-muted" />}
            </div>
            <div className="max-h-56 overflow-auto rounded-lg border border-border bg-bg">
              {planned.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-fg-muted">选择源项目、目标项目和配置目录后生成任务</div>
              ) : (
                planned.map((task, index) => (
                  <div key={`${task.targetProjectDir}-${task.configDirName}-${index}`} className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
                    <span className="w-28 shrink-0 font-mono text-sm">{task.configDirName}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">{task.targetProjectDir}</span>
                    {task.conflict && <span className="rounded bg-warning/10 px-2 py-0.5 text-xs text-warning">冲突</span>}
                  </div>
                ))
              )}
            </div>
          </Panel>

          {phase === "done" && (
            <Panel title="同步结果" desc={`成功 ${successCount}，跳过 ${skippedCount}，失败 ${failedCount}`}>
              <div className="max-h-60 overflow-auto rounded-lg border border-border bg-bg">
                {results.map((result, index) => (
                  <div key={`${result.target_path}-${index}`} className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
                    <span className="w-28 shrink-0 font-mono text-sm">{result.config_dir_name}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">{result.target_path}</span>
                    <span className={cn("text-xs", result.success ? "text-success" : "text-danger")}>
                      {result.success ? (result.skipped ? "已跳过" : result.overwritten ? "已覆盖" : "已复制") : result.error}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </main>

      <footer className="flex items-center gap-3 border-t border-border bg-bg-subtle px-5 py-3">
        <span className="text-sm text-fg-muted">
          已选 {selectedDirs.size} 个目录 · {targetDirs.length} 个目标项目
          {hasTargetErrors && " · 存在无效目标"}
        </span>
        <Button variant="primary" size="md" onClick={execute} disabled={!canExecute} className="ml-auto">
          {working && <Loader2 className="h-4 w-4 animate-spin" />}
          开始同步
        </Button>
      </footer>
    </div>
  );
}

function Panel({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-bg-subtle p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {desc && <p className="text-xs text-fg-muted">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

function PathPicker({
  value,
  placeholder,
  onPick,
  openPath,
  onOpened,
}: {
  value: string;
  placeholder: string;
  onPick: () => void;
  openPath?: string;
  onOpened?: (path: string) => void;
}) {
  return (
    <div className="flex gap-2">
      <Input value={value} placeholder={placeholder} readOnly className="font-mono text-xs" />
      <Button variant="outline" size="md" onClick={onPick}>
        <FolderOpen className="h-4 w-4" />
        选择
      </Button>
      {openPath && (
        <OpenWithButton
          path={openPath}
          label="打开"
          variant="ghost"
          size="md"
          onSuccess={(path) => onOpened?.(path)}
        />
      )}
    </div>
  );
}

function StatusLine({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-fg-muted">{icon}{text}</div>;
}

function samePath(a: string, b: string) {
  return a.trim().replace(/\//g, "\\").toLowerCase() === b.trim().replace(/\//g, "\\").toLowerCase();
}
