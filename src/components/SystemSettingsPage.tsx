import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Folder,
  FolderCog,
  FolderOpen,
  Loader2,
  MonitorCog,
  MonitorOff,
  Pencil,
  RotateCcw,
  Settings,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
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
import { cn } from "@/lib/utils";
import { tauri, type KnownFolder, type SetKnownFolderResult } from "@/lib/tauri";
import { useApp } from "@/stores/app";

interface Props {
  onOpenSettings: () => void;
}

type Notice = { tone: "success" | "warning" | "error"; text: string } | null;

type PendingAction =
  | { folder: KnownFolder; mode: "set"; newPath: string }
  | { folder: KnownFolder; mode: "restore"; newPath: string };

export function SystemSettingsPage({ onOpenSettings }: Props) {
  const { setAppMode } = useApp();
  const [turningOff, setTurningOff] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const [folders, setFolders] = useState<KnownFolder[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [applying, setApplying] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [moveFiles, setMoveFiles] = useState(false);

  const loadFolders = useCallback(async () => {
    setLoadingFolders(true);
    try {
      const list = await tauri.systemListKnownFolders();
      setFolders(list);
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setLoadingFolders(false);
    }
  }, []);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  async function turnOffDisplay() {
    setTurningOff(true);
    setNotice(null);
    try {
      await tauri.systemTurnOffDisplay();
      setNotice({
        tone: "success",
        text: "已发送关闭显示器指令,移动鼠标或按任意键即可重新点亮。",
      });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setTurningOff(false);
    }
  }

  async function startModify(folder: KnownFolder) {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: `选择「${folder.label}」的新位置`,
    });
    if (!picked || typeof picked !== "string") return;
    setMoveFiles(false);
    setPending({ folder, mode: "set", newPath: picked });
  }

  function startRestore(folder: KnownFolder) {
    setMoveFiles(false);
    setPending({ folder, mode: "restore", newPath: folder.default_path ?? "" });
  }

  function closeDialog() {
    setPending(null);
  }

  async function confirmChange() {
    if (!pending || applying) return;
    setApplying(true);
    try {
      const result: SetKnownFolderResult =
        pending.mode === "set"
          ? await tauri.systemSetKnownFolder(
              pending.folder.id,
              pending.newPath,
              moveFiles,
            )
          : await tauri.systemRestoreKnownFolder(pending.folder.id, moveFiles);

      const verb = pending.mode === "restore" ? "恢复为默认" : "修改";
      const tail =
        moveFiles && (result.moved_files > 0 || result.skipped_files > 0)
          ? `;已移动 ${result.moved_files} 项${result.skipped_files > 0 ? `,跳过 ${result.skipped_files} 个已存在项` : ""}`
          : "";
      setNotice({
        tone: "success",
        text: `已将「${pending.folder.label}」${verb}位置${tail}`,
      });
      setPending(null);
      await loadFolders();
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg text-fg">
      <div className="flex items-center gap-3 border-b border-border bg-bg px-4 py-2">
        <Button variant="ghost" size="sm" onClick={() => setAppMode("home")}>
          <ArrowLeft className="h-3.5 w-3.5" />
          模式
        </Button>
        <div>
          <div className="text-sm font-semibold text-fg">系统设置</div>
          <div className="text-xs text-fg-muted">集中管理电脑常用设置与快捷电源操作</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
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

      <main className="flex-1 overflow-auto p-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {/* 电源与显示 */}
          <div className="flex items-center gap-2 text-sm font-medium text-fg-muted">
            <MonitorCog className="h-4 w-4" />
            电源与显示
          </div>
          <section className="rounded-2xl border border-border bg-bg-subtle p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <MonitorOff className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-fg">关闭显示器</h2>
                <p className="mt-1 text-xs leading-5 text-fg-muted">
                  立即关闭显示器屏幕(等同系统电源菜单中的「关闭显示器」),不锁屏、不休眠。移动鼠标或按任意键即可唤醒。
                </p>
                <div className="mt-4">
                  <Button
                    variant="secondary"
                    onClick={() => void turnOffDisplay()}
                    disabled={turningOff}
                  >
                    {turningOff ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <MonitorOff className="h-3.5 w-3.5" />
                    )}
                    关闭显示器
                  </Button>
                </div>
              </div>
            </div>
          </section>

          {/* 系统文件夹 */}
          <div className="flex items-center gap-2 text-sm font-medium text-fg-muted">
            <FolderCog className="h-4 w-4" />
            系统文件夹
          </div>
          <section className="rounded-2xl border border-border bg-bg-subtle p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <FolderCog className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-fg">Windows 已知文件夹</h2>
                <p className="mt-1 text-xs leading-5 text-fg-muted">
                  桌面、文档、下载等文件夹具有系统特殊功能,其路径记录在注册表中。可在此查看当前地址并修改为自定义位置,修改后浏览器等程序会使用新路径;无需重启或注销即生效。
                </p>
              </div>
            </div>

            <div className="mt-5 border-t border-border">
              {loadingFolders ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-fg-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在读取系统文件夹…
                </div>
              ) : folders.length === 0 ? (
                <div className="py-10 text-center text-sm text-fg-muted">
                  未读取到任何系统文件夹
                </div>
              ) : (
                folders.map((folder) => (
                  <FolderRow
                    key={folder.id}
                    folder={folder}
                    disabled={applying}
                    onModify={() => void startModify(folder)}
                    onRestore={() => startRestore(folder)}
                    onOpen={() => {
                      if (folder.current_path)
                        void tauri.openInExplorer(folder.current_path);
                    }}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      </main>

      {/* 修改 / 恢复确认弹窗 */}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          {pending && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {pending.mode === "restore"
                    ? "恢复默认位置"
                    : "修改文件夹位置"}
                </DialogTitle>
                <DialogDescription>
                  {pending.folder.label} · {pending.folder.description}
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="flex flex-col gap-3 text-sm">
                <div>
                  <div className="text-xs text-fg-muted">当前位置</div>
                  <div className="mt-1 break-all font-mono text-xs text-fg-subtle">
                    {pending.folder.current_path ?? "未知"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-fg-muted">
                    {pending.mode === "restore" ? "默认位置" : "新位置"}
                  </div>
                  <div className="mt-1 break-all rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 font-mono text-xs text-fg">
                    {pending.newPath}
                  </div>
                </div>
                <label className="flex cursor-pointer items-start gap-2 pt-1">
                  <Checkbox
                    checked={moveFiles}
                    onCheckedChange={(v) => setMoveFiles(v === true)}
                  />
                  <span className="text-xs leading-5 text-fg-muted">
                    同时移动原文件夹中的现有文件到新位置(目标已存在的同名项将跳过)
                  </span>
                </label>
                {moveFiles && (
                  <p className="text-xs leading-5 text-warning">
                    移动大量文件可能耗时,期间请勿关闭本程序。
                  </p>
                )}
              </DialogBody>
              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={closeDialog} disabled={applying}>
                  取消
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void confirmChange()}
                  disabled={applying}
                >
                  {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  确认
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FolderRow({
  folder,
  disabled,
  onModify,
  onRestore,
  onOpen,
}: {
  folder: KnownFolder;
  disabled: boolean;
  onModify: () => void;
  onRestore: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border py-3 last:border-0">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-muted text-fg-muted">
        <Folder className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-fg">{folder.label}</span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
              folder.is_default
                ? "border-border bg-bg text-fg-muted"
                : "border-accent/30 bg-accent/5 text-accent",
            )}
          >
            {folder.is_default ? (
              <>
                <CheckCircle2 className="h-3 w-3" />
                默认
              </>
            ) : (
              <>
                <Pencil className="h-3 w-3" />
                已自定义
              </>
            )}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-fg-muted">{folder.description}</p>
        <div className="mt-1 break-all font-mono text-xs text-fg-subtle">
          {folder.current_path ?? "未知"}
        </div>
        {!folder.is_default && folder.default_path && (
          <div className="mt-0.5 break-all text-xs text-fg-subtle">
            默认 → <span className="font-mono">{folder.default_path}</span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          title="在资源管理器中打开"
          disabled={!folder.current_path}
          onClick={onOpen}
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </Button>
        <Button variant="secondary" size="sm" disabled={disabled} onClick={onModify}>
          <Pencil className="h-3.5 w-3.5" />
          修改
        </Button>
        {!folder.is_default && (
          <Button variant="ghost" size="sm" disabled={disabled} onClick={onRestore}>
            <RotateCcw className="h-3.5 w-3.5" />
            恢复默认
          </Button>
        )}
      </div>
    </div>
  );
}
