import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { OpenWithButton } from "@/components/OpenWithButton";
import {
  tauri,
  type NodeService,
  type NodeServiceInfo,
  type NodeServiceRunResult,
  type Settings,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { EmptyState as BaseEmptyState } from "@/components/ui/EmptyState";
import { useApp } from "@/stores/app";
import { AppHeader } from "@/components/AppHeader";
import {
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  Globe,
  Loader2,
  Package,
  Play,
  Plus,
  QrCode,
  Square,
  Terminal,
  Trash2,
  XCircle,
  X,
} from "lucide-react";

const TerminalLog = lazy(() =>
  import("@/components/TerminalLog").then((module) => ({
    default: module.TerminalLog,
  })),
);

interface Props {
  onOpenSettings: () => void;
}

interface TaskLog {
  serviceId: string;
  command: string;
  kind: string;
  httpUrl: string | null;
  stdout: string;
  stderr: string;
  running: boolean;
  success: boolean | null;
  exitCode: number | null;
  error: string | null;
  finishedAt: string | null;
}

// Printed by the built-in server script once it is listening.
const HTTP_READY_PATTERN = /HTTP_SERVER_READY (https?:\/\/\S+)/;

export function NodeServicesPage({ onOpenSettings }: Props) {
  const { settings, saveSettings } = useApp();
  const [activeServiceId, setActiveServiceId] = useState<string | null>(null);
  const [serviceInfo, setServiceInfo] = useState<Record<string, NodeServiceInfo>>({});
  const [infoLoading, setInfoLoading] = useState(false);
  const [newCommand, setNewCommand] = useState("");
  const [tasks, setTasks] = useState<Record<string, TaskLog>>({});
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  // Opt-in LAN exposure for the built-in static server; off by default so the
  // folder is never open to the network unless the user asks for it.
  const [httpAllowLan, setHttpAllowLan] = useState(false);

  if (!settings) return null;

  const currentSettings = settings;
  const services = currentSettings.node_services;
  const activeService = useMemo(
    () => services.find((service) => service.id === activeServiceId) ?? services[0] ?? null,
    [services, activeServiceId],
  );

  const activeServiceTasks = useMemo(() => {
    if (!activeService) return [];
    return Object.entries(tasks)
      .filter(([, task]) => task.serviceId === activeService.id)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([taskId, task]) => ({ taskId, ...task }));
  }, [tasks, activeService]);

  const info = activeService ? serviceInfo[activeService.id] : undefined;

  // Load existing task snapshots once (e.g. after remounting the page).
  useEffect(() => {
    let disposed = false;
    void tauri
      .nodeServiceListTasks()
      .then((states) => {
        if (disposed) return;
        setTasks((items) => {
          const next = { ...items };
          for (const state of states) {
            const ready = HTTP_READY_PATTERN.exec(state.stdout);
            next[state.task_id] = {
              serviceId: state.service_id,
              command: state.command,
              kind: state.kind,
              httpUrl: ready ? ready[1] : null,
              stdout: state.stdout,
              stderr: state.stderr,
              running: state.running,
              success: state.success,
              exitCode: state.exit_code,
              error: state.error,
              finishedAt: state.finished_at,
            };
          }
          return next;
        });
      })
      .catch((e) => {
        if (!disposed) setMessage(String(e));
      });
    return () => {
      disposed = true;
    };
  }, []);

  // Live log + exit events.
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void tauri.onNodeServiceLog((event) => {
      if (disposed) return;
      const ready = HTTP_READY_PATTERN.exec(event.line);
      setTasks((items) => {
        const current = items[event.task_id];
        const key = event.stream === "stderr" ? "stderr" : "stdout";
        if (!current) {
          // Event arrived before the run request resolved; don't drop early lines.
          return {
            ...items,
            [event.task_id]: {
              serviceId: event.service_id,
              command: "",
              kind: ready ? "http" : "",
              httpUrl: ready ? ready[1] : null,
              stdout: event.stream === "stderr" ? "" : event.line,
              stderr: event.stream === "stderr" ? event.line : "",
              running: true,
              success: null,
              exitCode: null,
              error: null,
              finishedAt: null,
            },
          };
        }
        return {
          ...items,
          [event.task_id]: {
            ...current,
            [key]: current[key] + event.line,
            kind: current.kind || (ready ? "http" : ""),
            httpUrl: ready ? ready[1] : current.httpUrl,
          },
        };
      });
    }).then((fn) => {
      if (disposed) fn();
      else unlisteners.push(fn);
    });
    void tauri.onNodeServiceExit((event) => {
      if (disposed) return;
      setTasks((items) => {
        const current = items[event.task_id];
        if (!current) return items;
        return {
          ...items,
          [event.task_id]: {
            ...current,
            running: false,
            success: event.success,
            exitCode: event.exit_code,
            error: event.error,
            finishedAt: new Date().toLocaleTimeString(),
          },
        };
      });
      setStoppingIds((ids) => {
        const next = new Set(ids);
        next.delete(event.task_id);
        return next;
      });
    }).then((fn) => {
      if (disposed) fn();
      else unlisteners.push(fn);
    });
    return () => {
      disposed = true;
      for (const fn of unlisteners) fn();
    };
  }, []);

  // Fetch package.json info for the active service.
  useEffect(() => {
    if (!activeService) return;
    let disposed = false;
    setInfoLoading(true);
    void tauri
      .nodeServiceReadInfo(activeService.path)
      .then((next) => {
        if (!disposed) setServiceInfo((items) => ({ ...items, [activeService.id]: next }));
      })
      .catch((e) => {
        if (!disposed) setMessage(String(e));
      })
      .finally(() => {
        if (!disposed) setInfoLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [activeService?.id, activeService?.path]);

  // Drop folders anywhere on the page to add them as services. Reads the store
  // directly so the drag listener never holds a stale settings snapshot.
  const addDroppedServices = useCallback(async (paths: string[]) => {
    const store = useApp.getState();
    const current = store.settings;
    if (!current) return;
    const currentServices = current.node_services;
    const directories = await tauri
      .filterTerminalProjectDirectories(paths)
      .catch(() => [] as string[]);
    if (directories.length === 0) {
      setMessage("只能拖入文件夹");
      return;
    }
    const existing = new Set(
      currentServices.map((service) => service.path.replace(/\//g, "\\").toLowerCase()),
    );
    const added: NodeService[] = [];
    for (const directory of directories) {
      const path = directory.replace(/\//g, "\\");
      const key = path.toLowerCase();
      if (existing.has(key)) continue;
      existing.add(key);
      added.push({
        id: `node-${Date.now()}-${added.length}`,
        name: baseName(path) || "Node 服务",
        path,
        commands: [],
      });
    }
    if (added.length === 0) {
      setMessage("拖入的文件夹已在列表中");
      return;
    }
    try {
      await store.saveSettings({ ...current, node_services: [...currentServices, ...added] });
      setActiveServiceId(added[0].id);
      const skipped = directories.length - added.length;
      setMessage(
        skipped > 0
          ? `已添加 ${added.length} 个服务文件夹，跳过 ${skipped} 个重复项`
          : `已添加 ${added.length} 个服务文件夹`,
      );
    } catch (e) {
      setMessage(String(e));
    }
  }, []);

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
          void addDroppedServices(event.payload.paths);
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
  }, [addDroppedServices]);

  async function updateSettings(patch: Partial<Settings>) {
    await saveSettings({ ...currentSettings, ...patch });
  }

  async function addService() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "选择 Node 服务文件夹",
    });
    if (!picked || typeof picked !== "string") return;
    const exists = services.some(
      (service) => service.path.toLowerCase() === picked.toLowerCase(),
    );
    if (exists) {
      setMessage("该文件夹已添加");
      return;
    }
    const name = baseName(picked) || "Node 服务";
    const service: NodeService = {
      id: `node-${Date.now()}`,
      name,
      path: picked,
      commands: [],
    };
    await updateSettings({ node_services: [...services, service] });
    setActiveServiceId(service.id);
    setMessage(null);
  }

  async function rebindService(service: NodeService) {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: service.path,
      title: "重新选择服务文件夹",
    });
    if (!picked || typeof picked !== "string") return;
    await updateService(service.id, { path: picked });
  }

  async function updateService(id: string, patch: Partial<NodeService>) {
    await updateSettings({
      node_services: services.map((service) =>
        service.id === id ? { ...service, ...patch } : service,
      ),
    });
  }

  async function removeService(id: string) {
    await tauri.nodeServiceStopService(id).catch(() => {});
    await updateSettings({
      node_services: services.filter((service) => service.id !== id),
    });
    if (activeServiceId === id) setActiveServiceId(null);
  }

  async function addSavedCommand(service: NodeService) {
    const command = newCommand.trim();
    if (!command) return;
    await updateService(service.id, { commands: [...service.commands, command] });
    setNewCommand("");
  }

  async function removeSavedCommand(service: NodeService, index: number) {
    await updateService(service.id, {
      commands: service.commands.filter((_, itemIndex) => itemIndex !== index),
    });
  }

  async function runCommand(service: NodeService, command: string) {
    setMessage(null);
    const result = await safeRun(service, command);
    if (!result) return;
    setActiveTaskId(result.task_id);
  }

  async function safeRun(
    service: NodeService,
    command: string,
  ): Promise<NodeServiceRunResult | null> {
    try {
      const result = await tauri.nodeServiceRun({
        service_id: service.id,
        service_path: service.path,
        command,
      });
      if (result.error) {
        setMessage(result.error);
        return null;
      }
      setTasks((items) => ({
        ...items,
        [result.task_id]: {
          serviceId: service.id,
          command: result.command || command,
          kind: "command",
          httpUrl: null,
          stdout: "",
          stderr: "",
          running: true,
          success: null,
          exitCode: null,
          error: null,
          finishedAt: null,
        },
      }));
      return result;
    } catch (e) {
      setMessage(String(e));
      return null;
    }
  }

  async function startHttpService(service: NodeService) {
    setMessage(null);
    try {
      const result = await tauri.nodeServiceStartHttp(service.id, service.path, httpAllowLan);
      if (result.error) {
        setMessage(result.error);
        return;
      }
      setTasks((items) => ({
        ...items,
        [result.task_id]: {
          serviceId: service.id,
          command: result.command,
          kind: "http",
          httpUrl: null,
          stdout: "",
          stderr: "",
          running: true,
          success: null,
          exitCode: null,
          error: null,
          finishedAt: null,
        },
      }));
      setActiveTaskId(result.task_id);
    } catch (e) {
      setMessage(String(e));
    }
  }

  async function stopTask(taskId: string) {
    setStoppingIds((ids) => new Set(ids).add(taskId));
    try {
      const result = await tauri.nodeServiceStopTask(taskId);
      if (!result.success) {
        setMessage(result.error ?? "停止失败");
        setStoppingIds((ids) => {
          const next = new Set(ids);
          next.delete(taskId);
          return next;
        });
      }
    } catch (e) {
      setMessage(String(e));
      setStoppingIds((ids) => {
        const next = new Set(ids);
        next.delete(taskId);
        return next;
      });
    }
  }

  async function stopServiceTasks(service: NodeService) {
    try {
      await tauri.nodeServiceStopService(service.id);
      setMessage("已停止该服务全部任务");
    } catch (e) {
      setMessage(String(e));
    }
  }

  async function clearTask(taskId: string) {
    try {
      await tauri.nodeServiceClearTask(taskId);
      setTasks((items) => {
        const next = { ...items };
        delete next[taskId];
        return next;
      });
      if (activeTaskId === taskId) setActiveTaskId(null);
    } catch (e) {
      setMessage(String(e));
    }
  }

  const displayTask = activeTaskId
    ? activeServiceTasks.find((task) => task.taskId === activeTaskId)
    : activeServiceTasks[0];
  const safeDisplayTask = displayTask ?? null;
  const displayServiceTasks = safeDisplayTask
    ? activeServiceTasks.map((task) =>
        task.taskId === safeDisplayTask.taskId ? { ...task, expanded: true } : { ...task, expanded: false },
      )
    : activeServiceTasks.map((task) => ({ ...task, expanded: false }));

  return (
    <div className="relative flex h-full w-full flex-col bg-bg text-fg">
      {dropActive && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-accent/5">
          <div className="rounded-xl border-2 border-dashed border-accent bg-bg/95 px-10 py-8 text-center shadow-lg">
            <FolderOpen className="mx-auto h-8 w-8 text-accent" />
            <div className="mt-2 text-sm font-semibold text-fg">松开鼠标添加服务文件夹</div>
            <div className="mt-1 text-xs text-fg-muted">支持一次拖入多个，重复的会自动跳过</div>
          </div>
        </div>
      )}
      <AppHeader
        title="Node 服务管理"
        subtitle="添加 Node 项目文件夹，快捷执行 npm / pnpm 等命令并实时查看输出"
        onOpenSettings={onOpenSettings}
        rightActions={
          message ? <span className="text-xs text-fg-muted">{message}</span> : undefined
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[320px_1fr]">
        <aside className="flex min-h-0 flex-col border-r border-border bg-bg-subtle">
          <section className="flex min-h-0 flex-1 flex-col p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">服务</h2>
              <Button variant="primary" size="sm" onClick={addService}>
                <Plus className="h-3.5 w-3.5" />
                添加
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {services.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-fg-muted">
                  点击「添加」选择，或把文件夹拖进窗口
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {services.map((service) => {
                    const runningCount = Object.values(tasks).filter(
                      (task) => task.serviceId === service.id && task.running,
                    ).length;
                    return (
                      <ServiceCard
                        key={service.id}
                        service={service}
                        active={activeService?.id === service.id}
                        runningCount={runningCount}
                        onSelect={setActiveServiceId}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </aside>

        <section className="min-h-0 overflow-auto p-5">
          {!activeService ? (
            <EmptyState text="请选择或添加一个 Node 服务文件夹，支持一键执行 npm/pnpm 启动脚本并实时预览日志" onAdd={addService} />
          ) : (
            <div className="mx-auto flex max-w-5xl flex-col gap-5">
              <Panel title="服务">
                <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                  <Field label="名称">
                    <Input
                      value={activeService.name}
                      onChange={(event) =>
                        void updateService(activeService.id, { name: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="文件夹路径">
                    <div className="flex gap-2">
                      <Input
                        value={activeService.path}
                        onChange={(event) =>
                          void updateService(activeService.id, { path: event.target.value })
                        }
                        className="font-mono text-xs"
                      />
                      <Button variant="outline" size="md" onClick={() => void rebindService(activeService)}>
                        <FolderOpen className="h-4 w-4" />
                        选择
                      </Button>
                    </div>
                  </Field>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <OpenWithButton path={activeService.path} label="打开文件夹" onError={setMessage} />
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() => void startHttpService(activeService)}
                    title="在该文件夹启动内置静态文件服务（默认仅本机可访问）"
                  >
                    <Globe className="h-4 w-4" />
                    HTTP 服务
                  </Button>
                  <label
                    className="inline-flex cursor-pointer items-center gap-2 text-xs text-fg-muted"
                    title="监听 0.0.0.0，局域网内其他设备可通过本机 IP 访问该文件夹。服务器无任何鉴权，只按需临时开启。首次使用需在 Windows 防火墙提示中放行 node。"
                  >
                    <Checkbox
                      checked={httpAllowLan}
                      onCheckedChange={(value) => setHttpAllowLan(Boolean(value))}
                    />
                    允许局域网访问
                  </label>
                  {infoLoading && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      读取 package.json...
                    </span>
                  )}
                  {info && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
                      <Package className="h-3.5 w-3.5" />
                      {info.has_package_json ? `检测到 package.json（${info.package_manager}）` : "没有 package.json"}
                      {info.has_node_modules ? " · 已安装依赖" : " · 未安装依赖"}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-danger hover:text-danger"
                    onClick={() => void removeService(activeService.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </Button>
                </div>
              </Panel>

              {info && info.scripts.length > 0 && (
                <Panel title={`package.json scripts（${info.package_manager} run ...）`}>
                  <div className="flex flex-wrap gap-2">
                    {info.scripts.map((script) => (
                      <button
                        key={script.name}
                        type="button"
                        onClick={() => void runCommand(activeService, script.command)}
                        className="group inline-flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-left text-xs transition hover:border-accent hover:bg-accent/5"
                        title={`运行: ${script.command}`}
                      >
                        <Play className="h-3.5 w-3.5 text-accent" />
                        <span className="font-semibold">{script.name}</span>
                        <span className="max-w-56 truncate font-mono text-fg-muted">{script.command}</span>
                      </button>
                    ))}
                  </div>
                </Panel>
              )}

              <Panel title="快捷命令">
                <div className="flex flex-col gap-2">
                  {activeService.commands.length === 0 && (
                    <div className="rounded border border-dashed border-border px-3 py-3 text-xs text-fg-muted">
                      还没有保存的快捷命令，输入后点击「保存」。
                    </div>
                  )}
                  {activeService.commands.map((command, index) => (
                    <div key={`${command}-${index}`} className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded border border-border bg-bg px-2 py-1.5 font-mono text-xs">
                        {command}
                      </code>
                      <Button variant="primary" size="sm" onClick={() => void runCommand(activeService, command)}>
                        <Play className="h-3.5 w-3.5" />
                        运行
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void removeSavedCommand(activeService, index)}
                        title="移除快捷命令"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Input
                      value={newCommand}
                      onChange={(event) => setNewCommand(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void addSavedCommand(activeService);
                      }}
                      placeholder="例如: npm run dev"
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="md"
                      disabled={!newCommand.trim()}
                      onClick={() => void addSavedCommand(activeService)}
                    >
                      <Plus className="h-4 w-4" />
                      保存
                    </Button>
                    <Button
                      variant="primary"
                      size="md"
                      disabled={!newCommand.trim()}
                      onClick={() => {
                        const command = newCommand.trim();
                        if (!command) return;
                        setNewCommand("");
                        void runCommand(activeService, command);
                      }}
                    >
                      <Terminal className="h-4 w-4" />
                      立即执行
                    </Button>
                  </div>
                </div>
              </Panel>

              <Panel
                title="任务"
                action={
                  activeServiceTasks.some((task) => task.running) ? (
                    <Button variant="danger" size="sm" onClick={() => void stopServiceTasks(activeService)}>
                      <Square className="h-3.5 w-3.5" />
                      全部停止
                    </Button>
                  ) : undefined
                }
              >
                {activeServiceTasks.length === 0 ? (
                  <div className="rounded border border-dashed border-border px-3 py-4 text-center text-xs text-fg-muted">
                    还没有任务，运行一个命令后这里会显示任务和输出。
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {displayServiceTasks.map((task) => (
                      <div
                        key={task.taskId}
                        className={cn(
                          "rounded-lg border bg-bg transition",
                          task.expanded ? "border-accent" : "border-border hover:border-border-strong",
                        )}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-xs"
                          onClick={() => setActiveTaskId(task.taskId)}
                        >
                          {task.running ? (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
                          ) : task.success ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                          ) : (
                            <XCircle className="h-4 w-4 shrink-0 text-danger" />
                          )}
                          <span
                            className="min-w-0 flex-1 truncate font-mono"
                            title={task.command}
                          >
                            {task.kind === "http"
                              ? "内置 HTTP 服务"
                              : task.command || "（任务命令未知）"}
                          </span>
                          <span className="shrink-0 text-fg-muted">
                            {task.running
                              ? "运行中"
                              : task.success
                                ? `成功 (${task.finishedAt ?? ""})`
                                : `失败 退出码 ${task.exitCode ?? "无"}`}
                          </span>
                          {task.running ? (
                            <span
                              role="button"
                              tabIndex={0}
                              className="shrink-0 rounded p-1 text-danger hover:bg-danger/10"
                              title="停止任务"
                              onClick={(event) => {
                                event.stopPropagation();
                                void stopTask(task.taskId);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.stopPropagation();
                                  void stopTask(task.taskId);
                                }
                              }}
                            >
                              {stoppingIds.has(task.taskId) ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Square className="h-3.5 w-3.5" />
                              )}
                            </span>
                          ) : (
                            <span
                              role="button"
                              tabIndex={0}
                              className="shrink-0 rounded p-1 text-fg-subtle hover:bg-bg-muted hover:text-fg"
                              title="移除任务记录"
                              onClick={(event) => {
                                event.stopPropagation();
                                void clearTask(task.taskId);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.stopPropagation();
                                  void clearTask(task.taskId);
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </button>
                        {task.expanded && (
                          <div className="border-t border-border p-2">
                            <TaskOutput task={task} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function TaskOutput({ task }: { task: TaskLog & { taskId: string; expanded: boolean } }) {
  const stdout = task.stdout;
  const stderr = task.stderr;
  const httpUrl = task.httpUrl;
  const hasOutput = Boolean(stdout || stderr);
  const [qrOpen, setQrOpen] = useState(false);
  return (
    <div>
      {task.kind === "http" && (
        <div className="mb-2 flex items-center gap-2 rounded border border-border bg-bg px-2 py-1.5 text-xs">
          <Globe className="h-3.5 w-3.5 shrink-0 text-accent" />
          <code className="min-w-0 flex-1 truncate font-mono">
            {httpUrl ?? "等待服务就绪..."}
          </code>
          {httpUrl && (
            <Button variant="outline" size="sm" onClick={() => setQrOpen(true)}>
              <QrCode className="h-3.5 w-3.5" />
              二维码
            </Button>
          )}
          {httpUrl && (
            <Button variant="outline" size="sm" onClick={() => void openUrl(httpUrl)}>
              <ExternalLink className="h-3.5 w-3.5" />
              打开浏览器
            </Button>
          )}
        </div>
      )}
      {task.kind === "http" && httpUrl && (
        <Dialog open={qrOpen} onOpenChange={setQrOpen}>
          <DialogContent width="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm">扫码访问</DialogTitle>
            </DialogHeader>
            <DialogBody className="flex flex-col items-center gap-3">
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG value={httpUrl} size={200} marginSize={2} level="M" />
              </div>
              <code className="max-w-full text-center font-mono text-xs break-all">
                {httpUrl}
              </code>
              <span className="text-xs text-fg-muted">
                同一局域网内的手机等设备扫码即可访问（需已勾选允许局域网访问，且防火墙放行）
              </span>
            </DialogBody>
          </DialogContent>
        </Dialog>
      )}
      {task.error && (
        <pre className="mb-2 whitespace-pre-wrap rounded bg-danger/10 p-2 text-xs text-danger">
          {task.error}
        </pre>
      )}
      {hasOutput ? (
        <Suspense fallback={<TerminalLogFallback />}>
          <TerminalLog stdout={stdout} stderr={stderr} />
        </Suspense>
      ) : (
        <div className="rounded border border-dashed border-border px-3 py-6 text-center text-xs text-fg-muted">
          {task.running ? "正在等待输出..." : "没有输出"}
        </div>
      )}
    </div>
  );
}

function ServiceCard({
  service,
  active,
  runningCount,
  onSelect,
}: {
  service: NodeService;
  active: boolean;
  runningCount: number;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(service.id)}
      className={cn(
        "flex items-stretch rounded-lg border bg-bg text-left transition hover:-translate-y-0.5",
        active ? "border-accent bg-accent/10 shadow-sm" : "border-border hover:border-border-strong",
      )}
    >
      <div className="min-w-0 flex-1 rounded-lg px-2.5 py-2.5">
        <div className="flex items-center gap-2">
          {runningCount > 0 && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
          )}
          <span className="truncate text-sm font-semibold">{service.name || "未命名服务"}</span>
          {runningCount > 0 && (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              {runningCount} 运行中
            </span>
          )}
        </div>
        <div className="mt-1 truncate font-mono text-xs text-fg-muted">{service.path}</div>
      </div>
    </button>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-bg-subtle p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function TerminalLogFallback() {
  return (
    <div className="rounded-lg border border-border bg-[#020617] px-3 py-6 text-center text-xs text-slate-400">
      正在加载终端...
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

function EmptyState({ text, onAdd }: { text: string; onAdd?: () => void }) {
  return (
    <BaseEmptyState
      icon={<FolderOpen className="h-6 w-6" />}
      title="暂无服务"
      description={text}
      action={
        onAdd && (
          <Button variant="primary" size="sm" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" />
            添加服务
          </Button>
        )
      }
      className="my-8"
    />
  );
}

function baseName(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
}
