import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
} from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Progress";
import { Select } from "@/components/ui/Select";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Loader2,
  SkipForward,
} from "lucide-react";
import { useApp } from "@/stores/app";
import {
  tauri,
  type ConflictStrategy,
  type CopyResultItem,
  type CopyTask,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Phase = "preview" | "running" | "done";

interface PlannedTask {
  task: CopyTask;
  extId: string;
  extName: string;
  targetEditorId: string;
  targetEditorName: string;
  conflictExisting?: { folder: string; version: string };
  isMsProprietary: boolean;
}

export function CopyDialog({ open, onClose }: Props) {
  const {
    scans,
    sourceEditorId,
    targetEditorIds,
    selectedFolders,
    settings,
    runningEditors,
    refresh,
  } = useApp();

  const [phase, setPhase] = useState<Phase>("preview");
  const initialStrategy: ConflictStrategy = useMemo(() => {
    const s = settings?.conflict_strategy ?? "ask";
    return s === "ask" ? "overwrite" : s;
  }, [settings]);
  const [strategy, setStrategy] = useState<ConflictStrategy>(initialStrategy);
  const [results, setResults] = useState<CopyResultItem[]>([]);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (open) {
      setPhase("preview");
      setResults([]);
      setStrategy(initialStrategy);
    }
  }, [open, initialStrategy]);

  const planned = useMemo<PlannedTask[]>(() => {
    if (!settings) return [];
    const sourceScan = scans.find((s) => s.editor.id === sourceEditorId);
    if (!sourceScan) return [];
    const targets = scans.filter((s) => targetEditorIds.has(s.editor.id));

    const out: PlannedTask[] = [];
    for (const ext of sourceScan.extensions) {
      if (!selectedFolders.has(ext.folder_name)) continue;
      for (const t of targets) {
        const existing = t.extensions.find((e) => e.id === ext.id);
        out.push({
          task: {
            source_path: ext.folder_path,
            target_dir: t.editor.path,
            folder_name: ext.folder_name,
          },
          extId: ext.id,
          extName: ext.display_name || ext.name,
          targetEditorId: t.editor.id,
          targetEditorName: t.editor.name,
          conflictExisting: existing
            ? { folder: existing.folder_name, version: existing.version }
            : undefined,
          isMsProprietary: ext.is_ms_proprietary,
        });
      }
    }
    return out;
  }, [
    scans,
    sourceEditorId,
    targetEditorIds,
    selectedFolders,
    settings,
  ]);

  const conflictCount = planned.filter((p) => p.conflictExisting).length;
  const msTargets = useMemo(() => {
    const set = new Set<string>();
    planned.forEach((p) => {
      if (p.isMsProprietary && p.targetEditorId !== "vscode") set.add(p.targetEditorId);
    });
    return set;
  }, [planned]);

  const runningTargets = useMemo(() => {
    return Array.from(targetEditorIds).filter((id) => runningEditors.has(id));
  }, [targetEditorIds, runningEditors]);

  async function execute() {
    setPhase("running");
    setWorking(true);
    try {
      const tasks = planned.map((p) => p.task);
      const r = await tauri.copyExtensions(tasks, strategy);
      setResults(r);
      setPhase("done");
    } finally {
      setWorking(false);
    }
  }

  async function done() {
    onClose();
    await refresh();
  }

  const successCount = results.filter((r) => r.success && !r.skipped).length;
  const skippedCount = results.filter((r) => r.skipped).length;
  const failedCount = results.filter((r) => !r.success).length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && phase !== "running" && onClose()}>
      <DialogContent width="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            复制扩展到目标编辑器
          </DialogTitle>
          <DialogDescription className="text-xs text-fg-muted">
            {phase === "preview"
              ? `准备复制 ${selectedFolders.size} 个扩展到 ${targetEditorIds.size} 个目标(共 ${planned.length} 个任务)`
              : phase === "running"
                ? "正在复制..."
                : "操作完成"}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {phase === "preview" && (
            <div className="flex flex-col gap-4">
              {runningTargets.length > 0 && (
                <Banner variant="warning">
                  以下目标编辑器正在运行,文件可能被占用,建议先关闭后再复制:
                  <span className="font-medium">
                    {" "}
                    {runningTargets
                      .map(
                        (id) =>
                          settings?.editors.find((e) => e.id === id)?.name ?? id,
                      )
                      .join(", ")}
                  </span>
                </Banner>
              )}
              {msTargets.size > 0 && (
                <Banner variant="warning">
                  选中扩展中包含 <strong>微软专有扩展</strong>(C/C++、Pylance
                  等)。
                  这些扩展在非 VSCode 编辑器中运行可能违反许可证,请自行评估风险后再继续。
                </Banner>
              )}
              {conflictCount > 0 && (
                <Banner variant="info">
                  目标编辑器已存在 <strong>{conflictCount}</strong>{" "}
                  个同名扩展,请选择冲突处理策略:
                </Banner>
              )}

              <div className="flex items-center gap-2 text-sm">
                <span>冲突处理:</span>
                <Select
                  value={strategy}
                  onChange={(e) =>
                    setStrategy(e.target.value as ConflictStrategy)
                  }
                >
                  <option value="overwrite">覆盖已存在</option>
                  <option value="skip">跳过已存在</option>
                </Select>
                <span className="text-xs text-fg-muted">
                  (默认值在设置里调整)
                </span>
              </div>

              <div className="rounded-lg border border-border bg-bg-subtle">
                <div className="border-b border-border bg-bg-muted px-3 py-1.5 text-xs font-medium text-fg-muted">
                  任务清单 ({planned.length})
                </div>
                <div className="max-h-64 overflow-auto">
                  {planned.map((p, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 border-b border-border/50 px-3 py-1.5 text-xs last:border-0"
                    >
                      <span className="font-mono text-fg">{p.extId}</span>
                      <ArrowRight className="h-3 w-3 text-fg-subtle" />
                      <span className="text-fg-muted">{p.targetEditorName}</span>
                      {p.conflictExisting && (
                        <span className="ml-auto rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
                          已存在 v{p.conflictExisting.version}
                        </span>
                      )}
                      {p.isMsProprietary && (
                        <AlertCircle className="h-3 w-3 text-warning" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {phase === "running" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-accent" />
              <div className="text-sm text-fg-muted">
                正在复制 {planned.length} 个任务...
              </div>
              <Progress value={50} className="w-full max-w-sm" />
            </div>
          )}

          {phase === "done" && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2">
                <Stat
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  color="text-success"
                  label="成功"
                  value={successCount}
                />
                <Stat
                  icon={<SkipForward className="h-4 w-4" />}
                  color="text-fg-muted"
                  label="跳过"
                  value={skippedCount}
                />
                <Stat
                  icon={<XCircle className="h-4 w-4" />}
                  color="text-danger"
                  label="失败"
                  value={failedCount}
                />
              </div>
              {failedCount > 0 && (
                <div className="rounded-lg border border-danger/30 bg-danger/5">
                  <div className="border-b border-danger/30 px-3 py-1.5 text-xs font-medium text-danger">
                    失败列表
                  </div>
                  <div className="max-h-40 overflow-auto">
                    {results
                      .filter((r) => !r.success)
                      .map((r, i) => (
                        <div
                          key={i}
                          className="border-b border-danger/20 px-3 py-1.5 text-xs last:border-0"
                        >
                          <div className="font-mono text-fg">{r.target_path}</div>
                          <div className="text-fg-muted">{r.error}</div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          {phase === "preview" && (
            <>
              <DialogClose asChild>
                <Button variant="ghost">取消</Button>
              </DialogClose>
              <Button
                variant="primary"
                onClick={execute}
                disabled={planned.length === 0 || working}
              >
                开始复制 ({planned.length})
              </Button>
            </>
          )}
          {phase === "running" && (
            <Button variant="ghost" disabled>
              进行中...
            </Button>
          )}
          {phase === "done" && (
            <Button variant="primary" onClick={done}>
              完成
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Banner({
  variant,
  children,
}: {
  variant: "info" | "warning" | "danger";
  children: React.ReactNode;
}) {
  const palette =
    variant === "warning"
      ? "border-warning/30 bg-warning/5 text-warning"
      : variant === "danger"
        ? "border-danger/30 bg-danger/5 text-danger"
        : "border-accent/30 bg-accent/5 text-accent";
  const Icon =
    variant === "warning"
      ? AlertTriangle
      : variant === "danger"
        ? XCircle
        : AlertCircle;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        palette,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="text-fg">{children}</div>
    </div>
  );
}

function Stat({
  icon,
  color,
  label,
  value,
}: {
  icon: React.ReactNode;
  color: string;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-subtle px-3 py-2.5">
      <div className={cn("flex items-center gap-1.5 text-xs", color)}>
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-2xl font-semibold text-fg">{value}</div>
    </div>
  );
}
