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
import {
  Trash2,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useApp } from "@/stores/app";
import { tauri, type DeleteResultItem, type DeleteTask } from "@/lib/tauri";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Phase = "preview" | "running" | "done";

export function DeleteDialog({ open, onClose }: Props) {
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
  const [results, setResults] = useState<DeleteResultItem[]>([]);

  useEffect(() => {
    if (open) {
      setPhase("preview");
      setResults([]);
    }
  }, [open]);

  // Selection is keyed by source folder_name; for delete we map back to ext.id
  // and remove ALL target extensions matching those ids (any version), since
  // "delete vue.volar" should clean up any vue.volar in the target editor.
  const planned = useMemo(() => {
    const sourceScan = scans.find((s) => s.editor.id === sourceEditorId);
    const selectedIds = new Set(
      (sourceScan?.extensions ?? [])
        .filter((e) => selectedFolders.has(e.folder_name))
        .map((e) => e.id),
    );
    const out: {
      extId: string;
      extName: string;
      targetEditorName: string;
      targetEditorId: string;
      path: string;
    }[] = [];
    const targets = scans.filter((s) => targetEditorIds.has(s.editor.id));
    for (const t of targets) {
      for (const ext of t.extensions) {
        if (selectedIds.has(ext.id)) {
          out.push({
            extId: ext.id,
            extName: ext.display_name || ext.name,
            targetEditorName: t.editor.name,
            targetEditorId: t.editor.id,
            path: ext.folder_path,
          });
        }
      }
    }
    return out;
  }, [scans, sourceEditorId, targetEditorIds, selectedFolders]);

  const runningTargets = useMemo(
    () => Array.from(targetEditorIds).filter((id) => runningEditors.has(id)),
    [targetEditorIds, runningEditors],
  );

  async function execute() {
    setPhase("running");
    const tasks: DeleteTask[] = planned.map((p) => ({ path: p.path }));
    const r = await tauri.deleteExtensions(tasks);
    setResults(r);
    setPhase("done");
  }

  async function done() {
    onClose();
    await refresh();
  }

  const successCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success).length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && phase !== "running" && onClose()}>
      <DialogContent width="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Trash2 className="h-5 w-5 text-danger" />
            从目标编辑器删除扩展
          </DialogTitle>
          <DialogDescription className="text-xs text-fg-muted">
            {phase === "preview"
              ? `将从 ${targetEditorIds.size} 个目标编辑器删除 ${planned.length} 个扩展(源编辑器不受影响)`
              : phase === "running"
                ? "正在删除..."
                : "操作完成"}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {phase === "preview" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div className="text-fg">
                  删除的扩展会先移入回收站{" "}
                  <code className="rounded bg-bg-muted px-1 py-0.5 text-xs">
                    %TEMP%\devhub-trash\
                  </code>
                  ,保留 {settings?.backup_days ?? 7} 天后自动清理。{" "}
                  <strong>源编辑器扩展不会被删除。</strong>
                </div>
              </div>
              {runningTargets.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div className="text-fg">
                    以下目标编辑器正在运行:{" "}
                    <span className="font-medium">
                      {runningTargets
                        .map(
                          (id) =>
                            settings?.editors.find((e) => e.id === id)?.name ??
                            id,
                        )
                        .join(", ")}
                    </span>
                    ,文件可能被占用,建议先关闭。
                  </div>
                </div>
              )}
              {planned.length === 0 && (
                <div className="rounded-lg border border-border bg-bg-subtle px-3 py-4 text-center text-sm text-fg-muted">
                  没有可删除的项 — 所选扩展在目标编辑器中均不存在
                </div>
              )}
              {planned.length > 0 && (
                <div className="rounded-lg border border-border bg-bg-subtle">
                  <div className="border-b border-border bg-bg-muted px-3 py-1.5 text-xs font-medium text-fg-muted">
                    将删除的目录 ({planned.length})
                  </div>
                  <div className="max-h-64 overflow-auto">
                    {planned.map((p, i) => (
                      <div
                        key={i}
                        className="border-b border-border/50 px-3 py-1.5 text-xs last:border-0"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-fg">{p.extName}</span>
                          <span className="text-fg-subtle">
                            {p.targetEditorName}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-fg-subtle truncate">
                          {p.path}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {phase === "running" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-accent" />
              <div className="text-sm text-fg-muted">
                正在删除 {planned.length} 项...
              </div>
            </div>
          )}

          {phase === "done" && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border bg-bg-subtle px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-xs text-success">
                    <CheckCircle2 className="h-4 w-4" />
                    成功移入回收站
                  </div>
                  <div className="mt-0.5 text-2xl font-semibold text-fg">
                    {successCount}
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-bg-subtle px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-xs text-danger">
                    <XCircle className="h-4 w-4" />
                    失败
                  </div>
                  <div className="mt-0.5 text-2xl font-semibold text-fg">
                    {failedCount}
                  </div>
                </div>
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
                          <div className="font-mono text-fg">{r.path}</div>
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
                variant="danger"
                onClick={execute}
                disabled={planned.length === 0}
              >
                确认删除 ({planned.length})
              </Button>
            </>
          )}
          {phase === "running" && (
            <Button variant="ghost" disabled>
              <Loader2 className="h-4 w-4 animate-spin" />
              进行中
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

