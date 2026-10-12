import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/Button";
import {
  tauri,
  type AiAgentStatus,
  type AiAgentTaskState,
  type NodeEnvStatus,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpCircle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Settings as SettingsIcon,
  Square,
  Trash2,
  XCircle,
} from "lucide-react";

const TerminalLog = lazy(() =>
  import("@/components/TerminalLog").then((module) => ({
    default: module.TerminalLog,
  })),
);

interface Props {
  onOpenSettings: () => void;
}

interface AgentTaskLog {
  agentId: string;
  kind: string;
  command: string;
  stdout: string;
  stderr: string;
  running: boolean;
  success: boolean | null;
  exitCode: number | null;
  error: string | null;
  finishedAt: string | null;
}

export function AiAgentManagerPage({ onOpenSettings }: Props) {
  const { setAppMode } = useApp();
  const [nodeStatus, setNodeStatus] = useState<NodeEnvStatus | null>(null);
  const [nodeChecking, setNodeChecking] = useState(true);
  const [agents, setAgents] = useState<AiAgentStatus[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [latest, setLatest] = useState<Record<string, string | null>>({});
  const [latestErrors, setLatestErrors] = useState<Record<string, string>>({});
  const [latestLoading, setLatestLoading] = useState(false);
  const [tasks, setTasks] = useState<Record<string, AgentTaskLog>>({});
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    setAgentsLoading(true);
    try {
      const list = await tauri.aiAgentList();
      setAgents(list);
      setMessage(null);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  const loadLatest = useCallback(async () => {
    setLatestLoading(true);
    try {
      const list = await tauri.aiAgentLatestVersions();
      const versions: Record<string, string | null> = {};
      const errors: Record<string, string> = {};
      for (const item of list) {
        versions[item.id] = item.version;
        if (item.error) errors[item.id] = item.error;
      }
      setLatest(versions);
      setLatestErrors(errors);
    } catch {
      // Latest versions are informational; a failed batch keeps old values.
    } finally {
      setLatestLoading(false);
    }
  }, []);

  const checkNode = useCallback(async () => {
    setNodeChecking(true);
    try {
      const status = await tauri.aiAgentCheckNode();
      setNodeStatus(status);
      if (status.available) {
        await loadAgents();
        void loadLatest();
      }
    } catch (e) {
      setNodeStatus({
        available: false,
        version: null,
        error: String(e),
      });
    } finally {
      setNodeChecking(false);
    }
  }, [loadAgents, loadLatest]);

  // Restore task snapshots (e.g. after remounting the page).
  useEffect(() => {
    let disposed = false;
    void tauri
      .aiAgentTaskList()
      .then((states: AiAgentTaskState[]) => {
        if (disposed) return;
        setTasks((items) => {
          const next = { ...items };
          for (const state of states) {
            next[state.task_id] = {
              agentId: state.agent_id,
              kind: state.kind,
              command: state.command,
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
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  // Live log + exit events.
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void tauri.onAiAgentLog((event) => {
      if (disposed) return;
      setTasks((items) => {
        const current = items[event.task_id];
        const key = event.stream === "stderr" ? "stderr" : "stdout";
        if (!current) {
          // Event arrived before the run request resolved; don't drop early lines.
          return {
            ...items,
            [event.task_id]: {
              agentId: event.agent_id,
              kind: "",
              command: "",
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
          },
        };
      });
    }).then((fn) => {
      if (disposed) fn();
      else unlisteners.push(fn);
    });
    void tauri.onAiAgentExit((event) => {
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
      // Refresh installed versions after install/uninstall finished.
      void loadAgents();
      // Re-query latest versions too: an update pins the previously advertised
      // version, so the badge must re-check against the registry afterwards.
      void loadLatest();
    }).then((fn) => {
      if (disposed) fn();
      else unlisteners.push(fn);
    });
    return () => {
      disposed = true;
      for (const fn of unlisteners) fn();
    };
  }, [loadAgents, loadLatest]);

  useEffect(() => {
    void checkNode();
  }, [checkNode]);

  const isAgentBusy = useCallback(
    (agentId: string) =>
      Object.values(tasks).some((task) => task.agentId === agentId && task.running),
    [tasks],
  );

  async function startTask(kind: "install" | "uninstall", agent: AiAgentStatus) {
    setMessage(null);
    if (kind === "uninstall") {
      const ok = await confirm(`确认卸载「${agent.name}」（npm uninstall -g ${agent.npm_package}）？`, {
        title: "确认卸载",
        kind: "warning",
        okLabel: "卸载",
        cancelLabel: "取消",
      });
      if (!ok) return;
    }
    try {
      // 安装/更新固定为页面上展示的最新版本，避免 npm 走缓存的旧元数据装到旧版。
      const result =
        kind === "install"
          ? await tauri.aiAgentInstall(agent.id, latest[agent.id] ?? null)
          : await tauri.aiAgentUninstall(agent.id);
      if (result.error) {
        setMessage(result.error);
        return;
      }
      setTasks((items) => ({
        ...items,
        [result.task_id]: {
          agentId: agent.id,
          kind,
          command: result.command,
          stdout: "",
          stderr: "",
          running: true,
          success: null,
          exitCode: null,
          error: null,
          finishedAt: null,
        },
      }));
    } catch (e) {
      setMessage(String(e));
    }
  }

  async function stopTask(taskId: string) {
    setStoppingIds((ids) => new Set(ids).add(taskId));
    try {
      const result = await tauri.aiAgentTaskStop(taskId);
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

  async function clearTask(taskId: string) {
    try {
      await tauri.aiAgentTaskClear(taskId);
      setTasks((items) => {
        const next = { ...items };
        delete next[taskId];
        return next;
      });
    } catch (e) {
      setMessage(String(e));
    }
  }

  const latestTaskByAgent = useMemo(() => {
    const map = new Map<string, AgentTaskLog & { taskId: string }>();
    for (const [taskId, task] of Object.entries(tasks)) {
      const current = map.get(task.agentId);
      // Task ids embed a timestamp, so a lexicographic compare orders them.
      if (!current || current.taskId.localeCompare(taskId) < 0) {
        map.set(task.agentId, { ...task, taskId });
      }
    }
    return map;
  }, [tasks]);

  return (
    <div className="flex h-full w-full flex-col bg-bg text-fg">
      <header className="flex items-center gap-3 border-b border-border bg-bg px-4 py-2">
        <Button variant="ghost" size="sm" onClick={() => setAppMode("home")}>
          <ArrowLeft className="h-3.5 w-3.5" />
          模式
        </Button>
        <div>
          <div className="text-sm font-semibold text-fg">AI Agent 管理</div>
          <div className="text-xs text-fg-muted">检测 Node 环境，通过 npm 安装、更新和卸载 AI Agent</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {message && <span className="max-w-96 truncate text-xs text-fg-muted" title={message}>{message}</span>}
          {nodeStatus?.available && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
              Node {nodeStatus.version ?? ""}
            </span>
          )}
          {nodeStatus?.available && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void loadAgents();
                void loadLatest();
              }}
              title="重新读取 npm 全局安装列表与最新版本"
              disabled={agentsLoading || latestLoading}
            >
              {agentsLoading || latestLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              刷新
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onOpenSettings}>
            <SettingsIcon className="h-3.5 w-3.5" />
            设置
          </Button>
        </div>
      </header>

      {nodeChecking && !nodeStatus ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-fg-muted">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          正在检测 Node 环境...
        </div>
      ) : nodeStatus && !nodeStatus.available ? (
        <NoNodeScreen
          detail={nodeStatus.error}
          onRecheck={() => void checkNode()}
          checking={nodeChecking}
        />
      ) : (
        <main className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            {agents.length === 0 && !agentsLoading ? (
              <div className="rounded-lg border border-dashed border-border px-3 py-10 text-center text-sm text-fg-muted">
                没有可管理的 AI Agent
              </div>
            ) : (
              agents.map((agent) => {
                const busy = isAgentBusy(agent.id);
                const task = latestTaskByAgent.get(agent.id) ?? null;
                return (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    busy={busy}
                    task={task}
                    stopping={task ? stoppingIds.has(task.taskId) : false}
                    latestVersion={latest[agent.id] ?? null}
                    latestLoading={latestLoading && !(agent.id in latest)}
                    latestError={latestErrors[agent.id] ?? null}
                    onInstall={() => void startTask("install", agent)}
                    onUninstall={() => void startTask("uninstall", agent)}
                    onStopTask={stopTask}
                    onClearTask={clearTask}
                  />
                );
              })
            )}
          </div>
        </main>
      )}
    </div>
  );
}

function NoNodeScreen({
  detail,
  onRecheck,
  checking,
}: {
  detail: string | null;
  onRecheck: () => void;
  checking: boolean;
}) {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center p-8">
      <div className="w-full max-w-md rounded-2xl border border-border bg-bg-subtle p-8 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-xl bg-danger/10 text-danger">
          <AlertTriangle className="h-8 w-8" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-fg">当前电脑没有 Node 环境</h2>
        <p className="mt-2 text-sm leading-6 text-fg-muted">
          AI Agent 通过 npm 全局安装，需要先安装 Node.js（建议 LTS 版本），安装完成后点击「重新检测」。
        </p>
        {detail && (
          <p className="mt-2 break-all rounded bg-bg px-2 py-1.5 font-mono text-xs text-fg-subtle">
            {detail}
          </p>
        )}
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button variant="primary" size="md" onClick={onRecheck} disabled={checking}>
            {checking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            重新检测
          </Button>
          <Button variant="outline" size="md" onClick={() => void openUrl("https://nodejs.org/")}>
            <ExternalLink className="h-4 w-4" />
            打开 Node.js 官网
          </Button>
        </div>
      </div>
    </main>
  );
}

function AgentCard({
  agent,
  busy,
  task,
  stopping,
  latestVersion,
  latestLoading,
  latestError,
  onInstall,
  onUninstall,
  onStopTask,
  onClearTask,
}: {
  agent: AiAgentStatus;
  busy: boolean;
  task: (AgentTaskLog & { taskId: string }) | null;
  stopping: boolean;
  latestVersion: string | null;
  latestLoading: boolean;
  latestError: string | null;
  onInstall: () => void;
  onUninstall: () => void;
  onStopTask: (taskId: string) => void;
  onClearTask: (taskId: string) => void;
}) {
  const installLabel = agent.installed ? "更新" : "安装";
  const hasUpdate =
    agent.installed &&
    latestVersion !== null &&
    agent.installed_version !== latestVersion;
  return (
    <section className="rounded-xl border border-border bg-bg-subtle p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">{agent.name}</h2>
            {agent.installed ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                <CheckCircle2 className="h-3 w-3" />
                已安装 {agent.installed_version}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-bg-muted px-2 py-0.5 text-xs font-medium text-fg-muted">
                <XCircle className="h-3 w-3" />
                未安装
              </span>
            )}
            {hasUpdate && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                <ArrowUpCircle className="h-3 w-3" />
                有新版本 {latestVersion}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs leading-5 text-fg-muted">{agent.description}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-fg-subtle">
            <span>包: {agent.npm_package}</span>
            <span>命令: {agent.command}</span>
            <span
              title={latestError ?? undefined}
            >
              最新:{" "}
              {latestLoading
                ? "查询中..."
                : latestVersion
                  ? `v${latestVersion}`
                  : latestError
                    ? "获取失败"
                    : "未知"}
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-1">
            <CommandRow
              label={agent.installed ? "安装/更新" : "安装"}
              command={agent.install_command}
            />
            <CommandRow label="卸载" command={agent.uninstall_command} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={onInstall}
            disabled={busy}
            title={agent.install_command}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {installLabel}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onUninstall}
            disabled={busy || !agent.installed}
          >
            <Trash2 className="h-3.5 w-3.5" />
            卸载
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void openUrl(agent.homepage)}
            title="打开 npm 包页面"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {task && (
        <div className="mt-3 rounded-lg border border-border bg-bg p-2">
          <div className="flex items-center gap-2 px-1 pb-2 text-xs">
            {task.running ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
            ) : task.success ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
            ) : (
              <XCircle className="h-3.5 w-3.5 shrink-0 text-danger" />
            )}
            <span className="min-w-0 flex-1 truncate font-mono" title={task.command}>
              {task.kind === "uninstall" ? "卸载" : "安装"} · {task.command}
            </span>
            <span className="shrink-0 text-fg-muted">
              {task.running
                ? "执行中"
                : task.success
                  ? `完成 (${task.finishedAt ?? ""})`
                  : `失败 退出码 ${task.exitCode ?? "无"}`}
            </span>
            {task.running ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger hover:text-danger"
                onClick={() => onStopTask(task.taskId)}
              >
                {stopping ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                停止
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onClearTask(task.taskId)}
                title="移除任务记录"
              >
                移除
              </Button>
            )}
          </div>
          {task.error && (
            <pre className="mb-2 whitespace-pre-wrap rounded bg-danger/10 p-2 text-xs text-danger">
              {task.error}
            </pre>
          )}
          {task.stdout || task.stderr ? (
            <Suspense
              fallback={
                <div className="rounded-lg border border-border bg-[#020617] px-3 py-6 text-center text-xs text-slate-400">
                  正在加载终端...
                </div>
              }
            >
              <TerminalLog stdout={task.stdout} stderr={task.stderr} />
            </Suspense>
          ) : (
            <div
              className={cn(
                "rounded border border-dashed border-border px-3 py-6 text-center text-xs text-fg-muted",
              )}
            >
              {task.running ? "正在等待输出..." : "没有输出"}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CommandRow({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied; the command text stays selectable anyway.
    }
  }
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-fg-muted">{label}</span>
      <code
        className="min-w-0 flex-1 truncate rounded border border-border bg-bg px-2 py-1.5 font-mono text-xs"
        title={command}
      >
        {command}
      </code>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void copy()}
        title="复制命令"
        disabled={copied}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-success" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}
