import { useCallback, useEffect, useMemo, useState } from "react";
import { confirm, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/Button";
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
import {
  tauri,
  type AiConfigTool,
  type AiConfigToolFile,
  type AiConfigToolStatus,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";
import { OpenWithButton } from "@/components/OpenWithButton";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  MinusCircle,
  Pencil,
  Plus,
  RefreshCcw,
  Settings,
  Trash2,
  Upload,
} from "lucide-react";

interface Props {
  onOpenSettings: () => void;
}

type Notice = {
  tone: "success" | "error";
  text: string;
};

export function AiConfigPage({ onOpenSettings }: Props) {
  const { settings, saveSettings, setAppMode } = useApp();
  const [statuses, setStatuses] = useState<AiConfigToolStatus[]>([]);
  const [filesById, setFilesById] = useState<Map<string, AiConfigToolFile[]>>(new Map());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dialogMode, setDialogMode] = useState<"add" | "edit" | null>(null);
  const [draft, setDraft] = useState<AiConfigTool | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const tools = settings?.ai_config_tools ?? [];
  const statusById = useMemo(
    () => new Map(statuses.map((status) => [status.id, status])),
    [statuses],
  );

  const refreshStatuses = useCallback(async () => {
    setStatusLoading(true);
    try {
      const [statusList, fileList] = await Promise.all([
        tauri.getAiConfigToolStatuses(),
        tauri.getAiConfigToolFiles(),
      ]);
      setStatuses(statusList);
      setFilesById(new Map(fileList.map((item) => [item.id, item.files])));
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatuses();
  }, [refreshStatuses, settings?.ai_config_tools]);

  if (!settings) return null;
  const currentSettings = settings;

  function openAddDialog() {
    setDialogMode("add");
    setDraft({ id: "", name: "", config_dir: "" });
    setFormError(null);
  }

  function openEditDialog(tool: AiConfigTool) {
    setDialogMode("edit");
    setDraft({ ...tool });
    setFormError(null);
  }

  function closeDialog() {
    if (working) return;
    setDialogMode(null);
    setDraft(null);
    setFormError(null);
  }

  async function pickDraftDirectory() {
    if (!draft) return;
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "选择 AI 工具配置目录",
      ...(draft.config_dir ? { defaultPath: draft.config_dir } : {}),
    });
    if (!picked || typeof picked !== "string") return;
    setDraft({ ...draft, config_dir: picked });
    setFormError(null);
  }

  async function saveDraft() {
    if (!draft || !dialogMode) return;
    const name = draft.name.trim();
    const configDir = normalizeWindowsPath(draft.config_dir.trim());
    if (!name) {
      setFormError("请输入工具名称");
      return;
    }
    if (!configDir) {
      setFormError("请选择或输入配置目录");
      return;
    }
    if (!isAbsoluteWindowsPath(configDir)) {
      setFormError("配置目录必须是 Windows 绝对路径");
      return;
    }

    const tool: AiConfigTool = {
      id: dialogMode === "add" ? createToolId() : draft.id,
      name,
      config_dir: configDir,
    };
    const nextTools =
      dialogMode === "add"
        ? [...tools, tool]
        : tools.map((item) => (item.id === tool.id ? tool : item));

    setWorking(true);
    try {
      await saveSettings({ ...currentSettings, ai_config_tools: nextTools });
      setNotice({
        tone: "success",
        text: dialogMode === "add" ? "工具已添加" : "工具已更新",
      });
      setDialogMode(null);
      setDraft(null);
      setFormError(null);
    } catch (error) {
      setFormError(String(error));
    } finally {
      setWorking(false);
    }
  }

  async function removeTool(tool: AiConfigTool) {
    const accepted = await confirm(`确定删除“${tool.name}”吗？`, {
      title: "删除 AI 工具",
      kind: "warning",
      okLabel: "删除",
      cancelLabel: "取消",
    });
    if (!accepted) return;

    setWorking(true);
    try {
      await saveSettings({
        ...currentSettings,
        ai_config_tools: tools.filter((item) => item.id !== tool.id),
      });
      setNotice({ tone: "success", text: `已删除 ${tool.name}` });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setWorking(false);
    }
  }

  async function importConfig() {
    const path = await openDialog({
      title: "导入 AI 工具配置",
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path || typeof path !== "string") return;

    setWorking(true);
    try {
      const next = await tauri.importAiConfigTools(path);
      await saveSettings(next);
      setNotice({ tone: "success", text: "配置已按 ID 合并导入" });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setWorking(false);
    }
  }

  async function exportConfig() {
    const path = await saveDialog({
      title: "导出 AI 工具配置",
      defaultPath: "ai-tool-configs.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path || typeof path !== "string") return;

    setWorking(true);
    try {
      await tauri.exportAiConfigTools(path);
      setNotice({ tone: "success", text: "配置已导出" });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg text-fg">
      <header className="flex items-center gap-3 border-b border-border bg-bg px-4 py-2">
        <Button variant="ghost" size="sm" onClick={() => setAppMode("home")}>
          <ArrowLeft className="h-3.5 w-3.5" />
          模式
        </Button>
        <div>
          <div className="text-sm font-semibold text-fg">AI 配置管理</div>
          <div className="text-xs text-fg-muted">管理 AI 工具的全局配置目录</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void importConfig()} disabled={working}>
            <Upload className="h-3.5 w-3.5" />
            导入
          </Button>
          <Button variant="outline" size="sm" onClick={() => void exportConfig()} disabled={working}>
            <Download className="h-3.5 w-3.5" />
            导出
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpenSettings}>
            <Settings className="h-3.5 w-3.5" />
            设置
          </Button>
        </div>
      </header>

      {notice && (
        <div
          className={cn(
            "flex items-center gap-2 border-b px-5 py-2 text-sm",
            notice.tone === "success"
              ? "border-success/20 bg-success/5 text-success"
              : "border-danger/20 bg-danger/5 text-danger",
          )}
        >
          {notice.tone === "success" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          <span className="min-w-0 flex-1 truncate">{notice.text}</span>
          <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
            关闭
          </Button>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-auto px-5 py-5">
        <div className="mx-auto w-full max-w-7xl">
          <div className="mb-3 flex items-center gap-3">
            <div>
              <h1 className="text-base font-semibold">配置目录</h1>
              <p className="text-xs text-fg-muted">{tools.length} 个工具</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void refreshStatuses()}
              disabled={statusLoading}
              className="ml-1"
              title="刷新目录状态"
            >
              <RefreshCcw className={cn("h-4 w-4", statusLoading && "animate-spin")} />
            </Button>
            <Button variant="primary" size="md" onClick={openAddDialog} className="ml-auto">
              <Plus className="h-4 w-4" />
              添加工具
            </Button>
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-bg">
            <div className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,2fr)_100px_220px] gap-3 border-b border-border bg-bg-subtle px-4 py-2 text-xs font-medium text-fg-muted">
              <span>工具</span>
              <span>配置目录</span>
              <span>状态</span>
              <span className="text-right">操作</span>
            </div>
            {tools.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-16 text-center text-fg-muted">
                <Bot className="mb-3 h-9 w-9 text-fg-subtle" />
                <div className="text-sm font-medium text-fg">还没有配置工具</div>
                <div className="mt-1 text-xs">添加一个工具并选择它的全局配置目录</div>
              </div>
            ) : (
              tools.map((tool) => {
                const status = statusById.get(tool.id);
                const canOpen = Boolean(status?.exists && status.is_dir);
                const files = filesById.get(tool.id) ?? [];
                const expanded = expandedId === tool.id;
                const hasFiles = files.length > 0;
                return (
                  <div key={tool.id} className="border-b border-border last:border-b-0">
                    <div className="grid min-h-16 grid-cols-[minmax(0,0.7fr)_minmax(0,2fr)_100px_220px] items-center gap-3 px-4 py-3">
                      <div className="flex min-w-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={() => setExpandedId(expanded ? null : tool.id)}
                          disabled={!hasFiles}
                          title={
                            hasFiles
                              ? expanded
                                ? "收起配置文件"
                                : "展开配置文件"
                              : "目录中没有可显示的文件"
                          }
                        >
                          {expanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                          <Bot className="h-4 w-4" />
                        </div>
                        <span className="truncate text-sm font-medium" title={tool.name}>{tool.name}</span>
                      </div>
                      <span className="truncate font-mono text-xs text-fg-muted" title={tool.config_dir}>
                        {tool.config_dir}
                      </span>
                      <DirectoryStatus status={status} loading={statusLoading} />
                      <div className="flex items-center justify-end gap-1.5">
                        <OpenWithButton
                          path={tool.config_dir}
                          disabled={!canOpen}
                          label="打开"
                          onError={(text) => setNotice({ tone: "error", text })}
                        />
                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(tool)} title="编辑">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void removeTool(tool)}
                          disabled={working}
                          title="删除"
                          className="hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {expanded && (
                      <ToolFilesPanel
                        files={files}
                        onError={(text) => setNotice({ tone: "error", text })}
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </main>

      <Dialog open={dialogMode !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent width="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              {dialogMode === "add" ? "添加 AI 工具" : "编辑 AI 工具"}
            </DialogTitle>
            <DialogDescription className="text-xs text-fg-muted">
              配置工具名称和全局配置目录的绝对路径
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">工具名称</span>
                <Input
                  value={draft?.name ?? ""}
                  onChange={(event) => draft && setDraft({ ...draft, name: event.target.value })}
                  placeholder="例如 Claude"
                  autoFocus
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">配置目录</span>
                <div className="flex gap-2">
                  <Input
                    value={draft?.config_dir ?? ""}
                    onChange={(event) => draft && setDraft({ ...draft, config_dir: event.target.value })}
                    placeholder="例如 C:\\Users\\name\\.claude"
                    className="font-mono text-xs"
                  />
                  <Button variant="outline" size="md" onClick={() => void pickDraftDirectory()}>
                    <FolderOpen className="h-4 w-4" />
                    选择
                  </Button>
                </div>
              </label>
              {formError && (
                <div className="flex items-center gap-2 rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {formError}
                </div>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="md" onClick={closeDialog} disabled={working}>
              取消
            </Button>
            <Button variant="primary" size="md" onClick={() => void saveDraft()} disabled={working}>
              {working && <Loader2 className="h-4 w-4 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DirectoryStatus({
  status,
  loading,
}: {
  status: AiConfigToolStatus | undefined;
  loading: boolean;
}) {
  if (loading || !status) {
    return <span className="text-xs text-fg-muted">检查中</span>;
  }
  if (status.exists && status.is_dir) {
    return (
      <span className="flex items-center gap-1 text-xs text-success">
        <CheckCircle2 className="h-3.5 w-3.5" />
        可用
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-warning">
      <AlertTriangle className="h-3.5 w-3.5" />
      {status.exists ? "不是目录" : "不存在"}
    </span>
  );
}

function ToolFilesPanel({
  files,
  onError,
}: {
  files: AiConfigToolFile[];
  onError: (message: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 bg-bg-subtle/60 px-4 pb-3 pt-1">
      {files.map((file) => (
        <div
          key={file.path}
          className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-1.5"
        >
          {file.is_dir ? (
            <Folder className="h-3.5 w-3.5 shrink-0 text-accent" />
          ) : (
            <FileText className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          )}
          <span className="shrink-0 font-mono text-xs text-fg" title={file.path}>
            {file.name}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-fg-muted" title={file.description}>
            {file.description}
          </span>
          {file.exists ? (
            <span className="flex shrink-0 items-center gap-1 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              已存在
            </span>
          ) : (
            <span className="flex shrink-0 items-center gap-1 text-xs text-fg-subtle">
              <MinusCircle className="h-3.5 w-3.5" />
              未创建
            </span>
          )}
          <OpenWithButton
            path={file.path}
            disabled={!file.exists}
            label="打开"
            onError={onError}
          />
        </div>
      ))}
    </div>
  );
}

function normalizeWindowsPath(path: string) {
  return path.replace(/\//g, "\\");
}

function isAbsoluteWindowsPath(path: string) {
  return /^[a-zA-Z]:\\/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path);
}

function createToolId() {
  return `ai-config-${crypto.randomUUID()}`;
}
