import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open as openDialog } from "@tauri-apps/plugin-dialog";
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
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { OpenWithButton } from "@/components/OpenWithButton";
import {
  tauri,
  type TerminalAiTool,
  type TerminalEnvGroup,
  type TerminalEnvVar,
  type TerminalProject,
  type TerminalSession,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  FolderPlus,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  Settings,
  Square,
  TerminalSquare,
  Trash2,
  Variable,
  X,
} from "lucide-react";

interface Props {
  onOpenSettings: () => void;
}

type Notice = { tone: "success" | "error"; text: string };
type ProjectDraft = TerminalProject;
type ToolDraft = TerminalAiTool;
type EnvVarDraft = { rowId: string; key: string; value: string };
type EnvGroupDraft = { id: string; name: string; variables: EnvVarDraft[] };

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

const SIDEBAR_WIDTH_KEY = "devhub:terminal-sidebar-width";
const SIDEBAR_MIN = 260;
const SIDEBAR_MAX = 640;
const SIDEBAR_DEFAULT = 340;

function loadSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n)) {
      return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(n)));
    }
  } catch {
    /* ignore */
  }
  return SIDEBAR_DEFAULT;
}

export function TerminalManagerPage({ onOpenSettings }: Props) {
  const { settings, saveSettings, setAppMode } = useApp();
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | "all" | null>(null);
  const [loading, setLoading] = useState(true);
  const [workingKey, setWorkingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [projectDialog, setProjectDialog] = useState<"add" | "edit" | null>(null);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft | null>(null);
  const [toolListOpen, setToolListOpen] = useState(false);
  const [toolDialog, setToolDialog] = useState<"add" | "edit" | null>(null);
  const [toolDraft, setToolDraft] = useState<ToolDraft | null>(null);
  const [envDialogOpen, setEnvDialogOpen] = useState(false);
  const [envGroupDialog, setEnvGroupDialog] = useState<"add" | "edit" | null>(null);
  const [envGroupDraft, setEnvGroupDraft] = useState<EnvGroupDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [projectDropActive, setProjectDropActive] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const projectListRef = useRef<HTMLDivElement>(null);
  const sidebarWidthRef = useRef(sidebarWidth);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    if (!resizingSidebar) return;

    const onMove = (event: MouseEvent) => {
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(event.clientX)));
      sidebarWidthRef.current = next;
      setSidebarWidth(next);
    };
    const onUp = () => {
      setResizingSidebar(false);
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidthRef.current));
      } catch {
        /* ignore */
      }
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizingSidebar]);

  const projects = settings?.terminal_projects ?? [];
  const tools = settings?.terminal_ai_tools ?? [];
  const envGroups = settings?.terminal_env_groups ?? [];
  const envActiveIds = settings?.terminal_env_active_group_ids ?? [];
  const envEnabled = settings?.terminal_env_enabled ?? false;
  const selectedProject =
    selectedProjectId === "all"
      ? null
      : projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;

  useEffect(() => {
    if (selectedProjectId !== "all" && selectedProject && selectedProject.id !== selectedProjectId) {
      setSelectedProjectId(selectedProject.id);
    }
  }, [selectedProject, selectedProjectId]);

  const refreshSessions = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setSessions(await tauri.listTerminalSessions());
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
    const timer = window.setInterval(() => void refreshSessions(true), 2000);
    return () => window.clearInterval(timer);
  }, [refreshSessions]);

  const filteredSessions = useMemo(
    () => selectedProjectId === "all"
      ? sessions
      : sessions.filter((session) => session.project_id === selectedProject?.id),
    [selectedProject?.id, selectedProjectId, sessions],
  );

  const sessionsByTool = useMemo(() => {
    const map = new Map<string, TerminalSession[]>();
    for (const session of filteredSessions) {
      const row = map.get(session.tool_id) ?? [];
      row.push(session);
      map.set(session.tool_id, row);
    }
    return map;
  }, [filteredSessions]);

  const visibleRows = useMemo(() => {
    const known = tools
      .map((tool) => ({ tool, sessions: sessionsByTool.get(tool.id) ?? [] }))
      .filter((row) => row.sessions.length > 0);
    const knownIds = new Set(tools.map((tool) => tool.id));
    const removed = Array.from(sessionsByTool.entries())
      .filter(([toolId]) => !knownIds.has(toolId))
      .map(([toolId, rowSessions]) => ({
        tool: { id: toolId, name: rowSessions[0]?.tool_name ?? toolId, command: "" },
        sessions: rowSessions,
      }));
    return [...known, ...removed];
  }, [sessionsByTool, tools]);

  const mergedEnv = useMemo(
    () => mergeTerminalEnv(envGroups, envActiveIds),
    [envActiveIds, envGroups],
  );

  if (!settings) return null;
  const currentSettings = settings;
  const boundTools = selectedProject
    ? selectedProject.tool_ids
        .map((id) => tools.find((tool) => tool.id === id))
        .filter((tool): tool is TerminalAiTool => Boolean(tool))
    : [];

  function openAddProject() {
    setProjectDialog("add");
    setProjectDraft({ id: "", name: "", path: "", tool_ids: tools.map((tool) => tool.id) });
    setFormError(null);
  }

  function openEditProject(project: TerminalProject) {
    setProjectDialog("edit");
    setProjectDraft({ ...project, tool_ids: [...project.tool_ids] });
    setFormError(null);
  }

  const addDroppedProjects = useCallback(async (paths: string[]) => {
    const directories = await tauri.filterTerminalProjectDirectories(paths);
    if (directories.length === 0) {
      setNotice({ tone: "error", text: "请拖入一个或多个项目文件夹" });
      return;
    }

    const existingPaths = new Set(
      projects.map((project) => normalizeWindowsPath(project.path).toLowerCase()),
    );
    const addedPaths = unique(directories.map(normalizeWindowsPath)).filter((path) => {
      const key = path.toLowerCase();
      if (existingPaths.has(key)) return false;
      existingPaths.add(key);
      return true;
    });
    if (addedPaths.length === 0) {
      setNotice({ tone: "error", text: "拖入的项目文件夹已在列表中" });
      return;
    }

    const droppedProjects = addedPaths.map((path) => ({
      id: createId("terminal-project"),
      name: projectNameFromPath(path),
      path,
      tool_ids: tools.map((tool) => tool.id),
    }));
    setWorkingKey("drop-projects");
    try {
      await saveSettings({
        ...currentSettings,
        terminal_projects: [...projects, ...droppedProjects],
      });
      setSelectedProjectId(droppedProjects[0].id);
      const skipped = directories.length - addedPaths.length;
      setNotice({
        tone: "success",
        text: skipped > 0
          ? `已添加 ${addedPaths.length} 个项目，跳过 ${skipped} 个已存在项目`
          : `已添加 ${addedPaths.length} 个项目`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setWorkingKey(null);
    }
  }, [currentSettings, projects, saveSettings, tools]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const isOverProjectList = (position: { x: number; y: number }) => {
      const rect = projectListRef.current?.getBoundingClientRect();
      if (!rect) return false;
      const scale = window.devicePixelRatio || 1;
      const x = position.x / scale;
      const y = position.y / scale;
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };

    void getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "leave") {
        setProjectDropActive(false);
        return;
      }
      const overProjectList = isOverProjectList(event.payload.position);
      setProjectDropActive(overProjectList);
      if (event.payload.type === "drop") {
        setProjectDropActive(false);
        if (overProjectList) void addDroppedProjects(event.payload.paths);
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [addDroppedProjects]);

  async function pickProjectPath() {
    if (!projectDraft) return;
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "选择 AI 终端项目目录",
      ...(projectDraft.path ? { defaultPath: projectDraft.path } : {}),
    });
    if (!picked || typeof picked !== "string") return;
    setProjectDraft({ ...projectDraft, path: picked });
    setFormError(null);
  }

  async function saveProjectDraft() {
    if (!projectDraft || !projectDialog) return;
    const name = projectDraft.name.trim();
    const path = normalizeWindowsPath(projectDraft.path.trim());
    if (!name) return setFormError("请输入项目名称");
    if (!isAbsoluteWindowsPath(path)) return setFormError("项目路径必须是 Windows 绝对路径");
    const project: TerminalProject = {
      ...projectDraft,
      id: projectDialog === "add" ? createId("terminal-project") : projectDraft.id,
      name,
      path,
      tool_ids: unique(projectDraft.tool_ids),
    };
    const nextProjects =
      projectDialog === "add"
        ? [...projects, project]
        : projects.map((item) => (item.id === project.id ? project : item));
    setWorkingKey("save-project");
    try {
      await saveSettings({ ...currentSettings, terminal_projects: nextProjects });
      setSelectedProjectId(project.id);
      setProjectDialog(null);
      setProjectDraft(null);
      setNotice({ tone: "success", text: projectDialog === "add" ? "项目已添加" : "项目已更新" });
    } catch (error) {
      setFormError(String(error));
    } finally {
      setWorkingKey(null);
    }
  }

  async function deleteProject(project: TerminalProject) {
    const count = sessions.filter((session) => session.project_id === project.id).length;
    const accepted = await confirm(
      count > 0
        ? `删除“${project.name}”会先关闭其 ${count} 个当前会话。是否继续？`
        : `确定删除项目“${project.name}”吗？`,
      { title: "删除终端项目", kind: "warning", okLabel: "删除", cancelLabel: "取消" },
    );
    if (!accepted) return;
    setWorkingKey(`delete-project:${project.id}`);
    try {
      if (count > 0) assertAction(await tauri.closeTerminalProjectSessions(project.id));
      await saveSettings({
        ...currentSettings,
        terminal_projects: projects.filter((item) => item.id !== project.id),
      });
      setSelectedProjectId((id) => (id === project.id ? null : id));
      await refreshSessions(true);
      setNotice({ tone: "success", text: `已删除 ${project.name}` });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setWorkingKey(null);
    }
  }

  async function launch(projectId: string, toolId: string, forceNew: boolean) {
    const key = `launch:${projectId}:${toolId}`;
    setWorkingKey(key);
    try {
      const result = await tauri.launchTerminalSession(projectId, toolId, forceNew);
      await refreshSessions(true);
      setNotice({
        tone: "success",
        text: result.created ? `已启动 ${result.session.tool_name}` : "已切换到最近的现有会话",
      });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setWorkingKey(null);
    }
  }

  async function focusSession(sessionId: string) {
    setWorkingKey(`focus:${sessionId}`);
    try {
      assertAction(await tauri.focusTerminalSession(sessionId));
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
      await refreshSessions(true);
    } finally {
      setWorkingKey(null);
    }
  }

  async function closeSession(sessionId: string) {
    setWorkingKey(`close:${sessionId}`);
    try {
      assertAction(await tauri.closeTerminalSession(sessionId));
      await refreshSessions(true);
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
      await refreshSessions(true);
    } finally {
      setWorkingKey(null);
    }
  }

  async function closeProjectSessions(project: TerminalProject) {
    const count = sessions.filter((session) => session.project_id === project.id).length;
    if (count === 0) return;
    const accepted = await confirm(`确定关闭“${project.name}”的 ${count} 个会话吗？`, {
      title: "关闭项目会话",
      kind: "warning",
      okLabel: "关闭全部",
      cancelLabel: "取消",
    });
    if (!accepted) return;
    setWorkingKey(`close-project:${project.id}`);
    try {
      assertAction(await tauri.closeTerminalProjectSessions(project.id));
      await refreshSessions(true);
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setWorkingKey(null);
    }
  }

  async function closeToolSessions(tool: TerminalAiTool, rowSessions: TerminalSession[]) {
    const count = rowSessions.length;
    const scope = selectedProject ? `“${selectedProject.name}”中 ` : "";
    const accepted = await confirm(`确定关闭${scope}${tool.name}整排的 ${count} 个会话吗？`, {
      title: "关闭工具会话",
      kind: "warning",
      okLabel: "关闭整排",
      cancelLabel: "取消",
    });
    if (!accepted) return;
    const key = `close-tool:${tool.id}`;
    setWorkingKey(key);
    try {
      if (selectedProject) {
        for (const session of rowSessions) {
          assertAction(await tauri.closeTerminalSession(session.id));
        }
      } else {
        assertAction(await tauri.closeTerminalToolSessions(tool.id));
      }
      await refreshSessions(true);
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setWorkingKey(null);
    }
  }

  function openAddTool() {
    setToolListOpen(false);
    setToolDialog("add");
    setToolDraft({ id: "", name: "", command: "" });
    setFormError(null);
  }

  function openEditTool(tool: TerminalAiTool) {
    setToolListOpen(false);
    setToolDialog("edit");
    setToolDraft({ ...tool });
    setFormError(null);
  }

  async function saveToolDraft() {
    if (!toolDraft || !toolDialog) return;
    const name = toolDraft.name.trim();
    const command = toolDraft.command.trim();
    if (!name) return setFormError("请输入工具名称");
    if (!command) return setFormError("请输入 PowerShell 启动命令");
    const tool: TerminalAiTool = {
      id: toolDialog === "add" ? createId("terminal-tool") : toolDraft.id,
      name,
      command,
    };
    const nextTools =
      toolDialog === "add"
        ? [...tools, tool]
        : tools.map((item) => (item.id === tool.id ? tool : item));
    setWorkingKey("save-tool");
    try {
      await saveSettings({ ...currentSettings, terminal_ai_tools: nextTools });
      setToolDialog(null);
      setToolDraft(null);
      setToolListOpen(true);
      setNotice({ tone: "success", text: toolDialog === "add" ? "工具已添加；已有项目未自动绑定" : "工具已更新" });
    } catch (error) {
      setFormError(String(error));
    } finally {
      setWorkingKey(null);
    }
  }

  async function deleteTool(tool: TerminalAiTool) {
    const count = sessions.filter((session) => session.tool_id === tool.id).length;
    const accepted = await confirm(
      count > 0
        ? `删除“${tool.name}”会先关闭整排 ${count} 个会话，并从所有项目解绑。是否继续？`
        : `确定删除工具“${tool.name}”并从所有项目解绑吗？`,
      { title: "删除 AI 终端工具", kind: "warning", okLabel: "删除", cancelLabel: "取消" },
    );
    if (!accepted) return;
    setWorkingKey(`delete-tool:${tool.id}`);
    try {
      if (count > 0) assertAction(await tauri.closeTerminalToolSessions(tool.id));
      await saveSettings({
        ...currentSettings,
        terminal_ai_tools: tools.filter((item) => item.id !== tool.id),
        terminal_projects: projects.map((project) => ({
          ...project,
          tool_ids: project.tool_ids.filter((id) => id !== tool.id),
        })),
      });
      await refreshSessions(true);
      setNotice({ tone: "success", text: `已删除 ${tool.name}` });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setWorkingKey(null);
    }
  }

  async function persistEnv(patch: {
    terminal_env_enabled?: boolean;
    terminal_env_groups?: TerminalEnvGroup[];
    terminal_env_active_group_ids?: string[];
  }, key: string) {
    setWorkingKey(key);
    try {
      await saveSettings({
        ...currentSettings,
        terminal_env_enabled: patch.terminal_env_enabled ?? envEnabled,
        terminal_env_groups: patch.terminal_env_groups ?? envGroups,
        terminal_env_active_group_ids: patch.terminal_env_active_group_ids ?? envActiveIds,
      });
      return null;
    } catch (error) {
      return String(error);
    } finally {
      setWorkingKey(null);
    }
  }

  async function toggleEnvEnabled() {
    const error = await persistEnv({ terminal_env_enabled: !envEnabled }, "env-enabled");
    if (error) setNotice({ tone: "error", text: error });
  }

  async function toggleEnvGroup(groupId: string, checked: boolean) {
    const terminal_env_active_group_ids = checked
      ? unique([...envActiveIds, groupId])
      : envActiveIds.filter((id) => id !== groupId);
    const error = await persistEnv({ terminal_env_active_group_ids }, `env-active:${groupId}`);
    if (error) setNotice({ tone: "error", text: error });
  }

  async function moveEnvGroup(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= envGroups.length) return;
    const next = [...envGroups];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    const error = await persistEnv({ terminal_env_groups: next }, "env-move");
    if (error) setNotice({ tone: "error", text: error });
  }

  function openAddEnvGroup() {
    setEnvDialogOpen(false);
    setEnvGroupDialog("add");
    setEnvGroupDraft({ id: "", name: "", variables: [emptyVarRow()] });
    setFormError(null);
  }

  function openEditEnvGroup(group: TerminalEnvGroup) {
    setEnvDialogOpen(false);
    setEnvGroupDialog("edit");
    setEnvGroupDraft({
      id: group.id,
      name: group.name,
      variables: group.variables.length > 0
        ? group.variables.map((variable) => ({ ...variable, rowId: createId("env-var") }))
        : [emptyVarRow()],
    });
    setFormError(null);
  }

  function closeEnvGroupDialog() {
    setEnvGroupDialog(null);
    setEnvGroupDraft(null);
    setFormError(null);
    setEnvDialogOpen(true);
  }

  async function saveEnvGroup() {
    if (!envGroupDraft || !envGroupDialog) return;
    const name = envGroupDraft.name.trim();
    if (!name) return setFormError("请输入组名称");
    const variables: TerminalEnvVar[] = [];
    const seen = new Set<string>();
    for (const row of envGroupDraft.variables) {
      const key = row.key.trim();
      if (!key && !row.value.trim()) continue;
      if (!key) return setFormError("请输入变量名");
      if (!ENV_KEY.test(key)) {
        return setFormError(`变量名无效: ${key}。需以字母或下划线开头，只能包含字母、数字和下划线`);
      }
      if (/[\r\n\0]/.test(row.value)) return setFormError(`变量“${key}”的值不能包含换行`);
      const lookup = key.toUpperCase();
      if (seen.has(lookup)) return setFormError(`变量名重复: ${key}`);
      seen.add(lookup);
      variables.push({ key, value: row.value });
    }
    const group: TerminalEnvGroup = {
      id: envGroupDialog === "add" ? createId("terminal-env") : envGroupDraft.id,
      name,
      variables,
    };
    const nextGroups = envGroupDialog === "add"
      ? [...envGroups, group]
      : envGroups.map((item) => (item.id === group.id ? group : item));
    const error = await persistEnv({ terminal_env_groups: nextGroups }, "save-env-group");
    if (error) return setFormError(error);
    setEnvGroupDialog(null);
    setEnvGroupDraft(null);
    setEnvDialogOpen(true);
    setNotice({ tone: "success", text: envGroupDialog === "add" ? "环境变量组已添加" : "环境变量组已更新" });
  }

  async function deleteEnvGroup(group: TerminalEnvGroup) {
    const accepted = await confirm(
      `确定删除环境变量组“${group.name}”吗？已打开的终端不会变化。`,
      { title: "删除环境变量组", kind: "warning", okLabel: "删除", cancelLabel: "取消" },
    );
    if (!accepted) return;
    const error = await persistEnv({
      terminal_env_groups: envGroups.filter((item) => item.id !== group.id),
      terminal_env_active_group_ids: envActiveIds.filter((id) => id !== group.id),
    }, `env-delete:${group.id}`);
    if (error) setNotice({ tone: "error", text: error });
    else setNotice({ tone: "success", text: `已删除 ${group.name}` });
  }

  function updateEnvVar(index: number, patch: Partial<Pick<EnvVarDraft, "key" | "value">>) {
    setEnvGroupDraft((draft) => draft && ({
      ...draft,
      variables: draft.variables.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    }));
  }

  function horizontalWheel(event: WheelEvent<HTMLDivElement>) {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const element = event.currentTarget;
    if (element.scrollWidth <= element.clientWidth) return;
    event.preventDefault();
    element.scrollLeft += event.deltaY;
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg text-fg">
      <header className="flex items-center gap-3 border-b border-border bg-bg px-4 py-2">
        <Button variant="ghost" size="sm" onClick={() => setAppMode("home")}>
          <ArrowLeft className="h-3.5 w-3.5" />
          模式
        </Button>
        <div>
          <div className="text-sm font-semibold">AI 终端管理</div>
          <div className="text-xs text-fg-muted">Windows Terminal 会话仅在本次应用运行期间跟踪</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={envEnabled ? "secondary" : "outline"}
            size="sm"
            onClick={() => {
              setFormError(null);
              setEnvDialogOpen(true);
            }}
            title="为新启动的 AI 终端注入临时环境变量"
          >
            <Variable className="h-3.5 w-3.5" />
            临时变量
            {envEnabled ? "开" : "关"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setToolListOpen(true)}>
            <Bot className="h-3.5 w-3.5" />
            管理工具
          </Button>
          <Button variant="ghost" size="icon" onClick={() => void refreshSessions()} title="刷新会话">
            <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpenSettings}>
            <Settings className="h-3.5 w-3.5" />
            设置
          </Button>
        </div>
      </header>

      {notice && (
        <div className={cn(
          "flex items-center gap-2 border-b px-4 py-2 text-sm",
          notice.tone === "success" ? "border-success/20 bg-success/5 text-success" : "border-danger/20 bg-danger/5 text-danger",
        )}>
          {notice.tone === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          <span className="min-w-0 flex-1 truncate">{notice.text}</span>
          <Button variant="ghost" size="icon" onClick={() => setNotice(null)} title="关闭提示">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <main className="flex min-h-0 flex-1">
        <aside
          className="flex min-h-0 shrink-0 flex-col border-r border-border bg-bg-subtle"
          style={{ width: sidebarWidth }}
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">项目</div>
              <div className="text-xs text-fg-muted">{projects.length} 个项目</div>
            </div>
            <Button variant="primary" size="sm" onClick={openAddProject} className="ml-auto shrink-0">
              <FolderPlus className="h-3.5 w-3.5" />
              添加
            </Button>
          </div>
          <div ref={projectListRef} className="relative min-h-0 flex-1 overflow-y-auto p-2">
            {projectDropActive && (
              <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center border-2 border-dashed border-accent bg-accent/10 text-center text-sm font-medium text-accent">
                松开以添加项目文件夹
              </div>
            )}
            <button
              className={cn(
                "mb-1 flex w-full items-center gap-2 border-l-2 px-2 py-2 text-left",
                selectedProjectId === "all"
                  ? "border-l-accent bg-bg"
                  : "border-l-transparent hover:bg-bg-muted",
              )}
              onClick={() => setSelectedProjectId("all")}
            >
              <TerminalSquare className="h-4 w-4 text-fg-muted" />
              <span className="flex-1 text-sm font-medium">全部</span>
              {sessions.length > 0 && (
                <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
                  {sessions.length}
                </span>
              )}
            </button>
            {projects.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center text-fg-muted">
                <FolderOpen className="mb-3 h-8 w-8 text-fg-subtle" />
                <div className="text-sm font-medium text-fg">还没有项目</div>
                <div className="mt-1 text-xs">添加项目后即可绑定并启动 AI CLI</div>
              </div>
            ) : projects.map((project) => {
              const count = sessions.filter((session) => session.project_id === project.id).length;
              const selected = selectedProjectId === project.id;
              return (
                <div key={project.id} className={cn("group mb-1 flex items-center border-l-2 px-2 py-2", selected ? "border-l-accent bg-bg" : "border-l-transparent hover:bg-bg-muted")}>
                  <button className="min-w-0 flex-1 text-left" onClick={() => setSelectedProjectId(project.id)} title={`${project.name}\n${project.path}`}>
                    <div className="truncate text-sm font-medium">{project.name}</div>
                    <div className="truncate font-mono text-[11px] text-fg-muted">{project.path}</div>
                  </button>
                  <div className="ml-1 flex shrink-0 items-center gap-0.5">
                    {count > 0 && <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">{count}</span>}
                    <OpenWithButton
                      path={project.path}
                      showLabel={false}
                      variant="ghost"
                      size="sm"
                      title="打开项目目录"
                      onError={(text) => setNotice({ tone: "error", text })}
                    />
                    <Button variant="ghost" size="icon" onClick={() => openEditProject(project)} title="编辑项目" className="h-7 w-7">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => void closeProjectSessions(project)} disabled={count === 0 || workingKey === `close-project:${project.id}`} title="关闭该项目全部会话" className="h-7 w-7">
                      <Square className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => void deleteProject(project)} disabled={Boolean(workingKey)} title="删除项目" className="h-7 w-7 text-danger">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {selectedProject && (
            <div className="border-t border-border bg-bg p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold">{selectedProject.name}</div>
                  <div className="text-[11px] text-fg-muted">已绑定 {boundTools.length} 个工具</div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => openEditProject(selectedProject)} title="编辑绑定">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="grid max-h-44 grid-cols-2 gap-2 overflow-y-auto pr-1">
                {boundTools.map((tool) => {
                  const key = `launch:${selectedProject.id}:${tool.id}`;
                  return (
                    <Button key={tool.id} variant="secondary" size="md" onClick={() => void launch(selectedProject.id, tool.id, false)} disabled={workingKey === key} title={tool.command} className="min-w-0 justify-start">
                      {workingKey === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                      <span className="truncate">{tool.name}</span>
                    </Button>
                  );
                })}
                {boundTools.length === 0 && <div className="col-span-2 py-4 text-center text-xs text-fg-muted">编辑项目以绑定工具</div>}
              </div>
            </div>
          )}
        </aside>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整项目栏宽度"
          title="拖动调整宽度"
          onMouseDown={(event) => {
            event.preventDefault();
            setResizingSidebar(true);
          }}
          className={cn(
            "group relative z-10 w-1 shrink-0 cursor-col-resize bg-border transition-colors",
            "hover:bg-accent/60",
            resizingSidebar && "bg-accent",
          )}
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>

        <section className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-bg px-5 py-4">
          <div className="mb-4 flex items-center gap-3">
            <div>
              <h1 className="text-base font-semibold">活动会话</h1>
              <p className="text-xs text-fg-muted">
                {selectedProject ? `仅显示“${selectedProject.name}”的 ` : "显示全部 "}
                {filteredSessions.length} 个存活窗口
              </p>
            </div>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-fg-muted" />}
          </div>

          {!loading && filteredSessions.length === 0 ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center border-y border-border text-center text-fg-muted">
              <TerminalSquare className="mb-3 h-10 w-10 text-fg-subtle" />
              <div className="text-sm font-medium text-fg">没有活动会话</div>
              <div className="mt-1 text-xs">
                {selectedProject ? "该项目还没有活动会话" : "从左侧选择项目并启动一个 AI 工具"}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {visibleRows.map(({ tool, sessions: rowSessions }) => (
                <div key={tool.id} className="border-y border-border bg-bg-subtle/40 py-3">
                  <div className="mb-3 flex items-center gap-2 px-1">
                    <Bot className="h-4 w-4 text-accent" />
                    <h2 className="text-sm font-semibold">{tool.name}</h2>
                    <span className="rounded bg-bg-muted px-1.5 py-0.5 text-[11px] text-fg-muted">{rowSessions.length} 个会话</span>
                    <Button variant="outline" size="sm" onClick={() => void closeToolSessions(tool, rowSessions)} disabled={workingKey === `close-tool:${tool.id}`} className="ml-auto">
                      <Square className="h-3.5 w-3.5" />
                      关闭整排
                    </Button>
                  </div>
                  <div className="flex gap-3 overflow-x-auto px-1 pb-2" onWheel={horizontalWheel}>
                    {rowSessions.map((session) => (
                      <div
                        key={session.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => void focusSession(session.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void focusSession(session.id);
                          }
                        }}
                        className="flex h-[132px] w-[248px] shrink-0 cursor-pointer flex-col border border-border bg-bg p-3 text-left shadow-sm transition hover:border-accent hover:shadow-md focus:outline-none focus:ring-2 focus:ring-accent"
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">{session.project_name}</div>
                            <div className="mt-0.5 truncate font-mono text-[10px] text-fg-muted">{session.project_path}</div>
                          </div>
                          <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-semibold text-accent">#{session.tool_sequence}</span>
                        </div>
                        <div className="mt-auto flex items-end justify-between gap-2">
                          <div>
                            <div className="text-[10px] uppercase text-fg-subtle">启动时间</div>
                            <div className="text-xs text-fg-muted">{formatStartedAt(session.started_at)}</div>
                          </div>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" onClick={(event) => { event.stopPropagation(); void launch(session.project_id, session.tool_id, true); }} title="新开同项目同工具会话" className="h-7 w-7">
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={(event) => { event.stopPropagation(); void closeSession(session.id); }} title="关闭会话" disabled={workingKey === `close:${session.id}`} className="h-7 w-7 text-danger">
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <Dialog open={projectDialog !== null} onOpenChange={(open) => !open && !workingKey && setProjectDialog(null)}>
        <DialogContent width="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">{projectDialog === "add" ? "添加终端项目" : "编辑终端项目"}</DialogTitle>
            <DialogDescription className="text-xs text-fg-muted">新项目默认绑定当前全部工具，可在下方调整</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg-muted">项目名称</span>
              <Input value={projectDraft?.name ?? ""} onChange={(event) => projectDraft && setProjectDraft({ ...projectDraft, name: event.target.value })} autoFocus />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg-muted">绝对路径</span>
              <div className="flex gap-2">
                <Input value={projectDraft?.path ?? ""} onChange={(event) => projectDraft && setProjectDraft({ ...projectDraft, path: event.target.value })} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => void pickProjectPath()} title="选择目录"><FolderOpen className="h-4 w-4" /></Button>
              </div>
            </label>
            <div>
              <div className="mb-2 text-xs font-medium text-fg-muted">绑定工具</div>
              <div className="grid grid-cols-2 gap-2">
                {tools.map((tool) => {
                  const checked = projectDraft?.tool_ids.includes(tool.id) ?? false;
                  return (
                    <label key={tool.id} className="flex items-center gap-2 border border-border bg-bg-subtle px-3 py-2 text-sm">
                      <Checkbox checked={checked} onCheckedChange={(value) => projectDraft && setProjectDraft({ ...projectDraft, tool_ids: value ? unique([...projectDraft.tool_ids, tool.id]) : projectDraft.tool_ids.filter((id) => id !== tool.id) })} />
                      <span className="truncate">{tool.name}</span>
                    </label>
                  );
                })}
                {tools.length === 0 && <div className="col-span-2 py-4 text-center text-xs text-fg-muted">请先添加 AI 工具</div>}
              </div>
            </div>
            {formError && <div className="text-xs text-danger">{formError}</div>}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setProjectDialog(null)} disabled={Boolean(workingKey)}><X className="h-4 w-4" />取消</Button>
            <Button variant="primary" onClick={() => void saveProjectDraft()} disabled={workingKey === "save-project"}><Check className="h-4 w-4" />保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={toolListOpen} onOpenChange={setToolListOpen}>
        <DialogContent width="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">AI 终端工具</DialogTitle>
            <DialogDescription className="text-xs text-fg-muted">命令将在 PowerShell 中以最高 AI CLI 批准/沙箱权限启动，不申请 Windows UAC 权限</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="mb-3 flex justify-end"><Button variant="primary" size="sm" onClick={openAddTool}><Plus className="h-3.5 w-3.5" />添加工具</Button></div>
            <div className="overflow-hidden border border-border">
              <div className="grid grid-cols-[150px_minmax(0,1fr)_80px] gap-3 border-b border-border bg-bg-subtle px-3 py-2 text-xs font-medium text-fg-muted"><span>工具</span><span>PowerShell 命令</span><span className="text-right">操作</span></div>
              {tools.map((tool) => (
                <div key={tool.id} className="grid grid-cols-[150px_minmax(0,1fr)_80px] items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
                  <span className="truncate text-sm font-medium">{tool.name}</span>
                  <code className="truncate text-xs text-fg-muted" title={tool.command}>{tool.command}</code>
                  <div className="flex justify-end">
                    <Button variant="ghost" size="icon" onClick={() => openEditTool(tool)} title="编辑工具"><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => void deleteTool(tool)} disabled={Boolean(workingKey)} title="删除工具" className="text-danger"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ))}
              {tools.length === 0 && <div className="py-10 text-center text-xs text-fg-muted">还没有 AI 终端工具</div>}
            </div>
          </DialogBody>
          <DialogFooter><Button variant="primary" onClick={() => setToolListOpen(false)}>完成</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={toolDialog !== null} onOpenChange={(open) => !open && !workingKey && setToolDialog(null)}>
        <DialogContent width="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">{toolDialog === "add" ? "添加 AI 工具" : "编辑 AI 工具"}</DialogTitle>
            <DialogDescription className="text-xs text-fg-muted">应用不会探测或安装 CLI；命令失败时 Terminal 会保留以显示错误</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <label className="block"><span className="mb-1 block text-xs font-medium text-fg-muted">工具名称</span><Input value={toolDraft?.name ?? ""} onChange={(event) => toolDraft && setToolDraft({ ...toolDraft, name: event.target.value })} autoFocus /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-fg-muted">PowerShell 启动命令</span><Input value={toolDraft?.command ?? ""} onChange={(event) => toolDraft && setToolDraft({ ...toolDraft, command: event.target.value })} className="font-mono text-xs" /></label>
            {formError && <div className="text-xs text-danger">{formError}</div>}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setToolDialog(null); setToolListOpen(true); }} disabled={Boolean(workingKey)}><X className="h-4 w-4" />取消</Button>
            <Button variant="primary" onClick={() => void saveToolDraft()} disabled={workingKey === "save-tool"}><Check className="h-4 w-4" />保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={envDialogOpen} onOpenChange={(open) => !open && !workingKey && setEnvDialogOpen(false)}>
        <DialogContent width="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">临时环境变量</DialogTitle>
            <DialogDescription className="text-xs text-fg-muted">
              开关开启后，新启动的 AI 终端会在 PowerShell 里设置已勾选组的变量。已打开的窗口保持原样，关闭窗口后变量即消失。
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="flex items-center gap-3 border border-border bg-bg-subtle px-3 py-3">
              <EnvSwitch checked={envEnabled} disabled={workingKey === "env-enabled"} onClick={() => void toggleEnvEnabled()} />
              <div className="min-w-0">
                <div className="text-sm font-medium">{envEnabled ? "启动时注入已勾选的组" : "启动时不注入临时变量"}</div>
                <div className="text-xs text-fg-muted">对所有新打开的 AI 终端生效。变量值保存在本机设置中，也会出现在该窗口的启动命令里。</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold">变量组</div>
                <div className="text-xs text-fg-muted">可同时勾选多组。列表中靠后的组会覆盖同名变量，不区分大小写。</div>
              </div>
              <Button variant="primary" size="sm" onClick={openAddEnvGroup} className="ml-auto shrink-0">
                <Plus className="h-3.5 w-3.5" />
                添加组
              </Button>
            </div>

            <div className="overflow-hidden border border-border">
              {envGroups.map((group, index) => {
                const checked = envActiveIds.includes(group.id);
                return (
                  <div key={group.id} className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
                    <Checkbox
                      checked={checked}
                      disabled={Boolean(workingKey)}
                      onCheckedChange={(value) => void toggleEnvGroup(group.id, value === true)}
                      aria-label={`使用 ${group.name}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{group.name}</div>
                      <div className="truncate text-xs text-fg-muted">
                        {group.variables.length === 0
                          ? "没有变量"
                          : group.variables.map((variable) => variable.key).join("、")}
                      </div>
                    </div>
                    <div className="flex shrink-0">
                      <Button variant="ghost" size="icon" onClick={() => void moveEnvGroup(index, -1)} disabled={index === 0 || Boolean(workingKey)} title="上移" className="h-7 w-7">
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => void moveEnvGroup(index, 1)} disabled={index === envGroups.length - 1 || Boolean(workingKey)} title="下移" className="h-7 w-7">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEditEnvGroup(group)} title="编辑组" className="h-7 w-7">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => void deleteEnvGroup(group)} disabled={Boolean(workingKey)} title="删除组" className="h-7 w-7 text-danger">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
              {envGroups.length === 0 && (
                <div className="py-10 text-center text-xs text-fg-muted">还没有环境变量组。添加后勾选，即可在启动时一起注入。</div>
              )}
            </div>

            <div>
              <div className="mb-2 text-xs font-medium text-fg-muted">
                {envEnabled
                  ? `开关开启，本次新终端会注入 ${mergedEnv.length} 个变量`
                  : "开关关闭，下面的组合并结果不会注入"}
              </div>
              {mergedEnv.length > 0 && (
                <div className="max-h-28 overflow-y-auto border border-border bg-bg-subtle">
                  {mergedEnv.map((variable) => (
                    <div key={variable.key.toUpperCase()} className="grid grid-cols-[160px_minmax(0,1fr)] gap-3 border-b border-border px-3 py-1.5 last:border-b-0">
                      <code className="truncate text-xs">{variable.key}</code>
                      <code className="truncate text-xs text-fg-muted" title={variable.value}>{variable.value || "（空）"}</code>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="primary" onClick={() => setEnvDialogOpen(false)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={envGroupDialog !== null} onOpenChange={(open) => !open && !workingKey && closeEnvGroupDialog()}>
        <DialogContent width="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">{envGroupDialog === "add" ? "添加环境变量组" : "编辑环境变量组"}</DialogTitle>
            <DialogDescription className="text-xs text-fg-muted">同一组内变量名不能重复。空值会在启动时把该变量设为空字符串。</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg-muted">组名称</span>
              <Input
                value={envGroupDraft?.name ?? ""}
                onChange={(event) => envGroupDraft && setEnvGroupDraft({ ...envGroupDraft, name: event.target.value })}
                autoFocus
              />
            </label>
            <div>
              <div className="mb-2 flex items-center">
                <span className="text-xs font-medium text-fg-muted">变量</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => envGroupDraft && setEnvGroupDraft({
                    ...envGroupDraft,
                    variables: [...envGroupDraft.variables, emptyVarRow()],
                  })}
                >
                  <Plus className="h-3.5 w-3.5" />
                  添加变量
                </Button>
              </div>
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {envGroupDraft?.variables.map((variable, index) => (
                  <div key={variable.rowId} className="flex gap-2">
                    <Input
                      value={variable.key}
                      onChange={(event) => updateEnvVar(index, { key: event.target.value })}
                      placeholder="变量名"
                      className="w-40 shrink-0 font-mono text-xs"
                    />
                    <Input
                      value={variable.value}
                      onChange={(event) => updateEnvVar(index, { value: event.target.value })}
                      placeholder="变量值"
                      className="min-w-0 font-mono text-xs"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      title="删除变量"
                      className="shrink-0 text-danger"
                      onClick={() => envGroupDraft && setEnvGroupDraft({
                        ...envGroupDraft,
                        variables: envGroupDraft.variables.filter((row) => row.rowId !== variable.rowId),
                      })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                {envGroupDraft?.variables.length === 0 && (
                  <div className="border border-dashed border-border py-6 text-center text-xs text-fg-muted">这一组还没有变量</div>
                )}
              </div>
            </div>
            {formError && <div className="text-xs text-danger">{formError}</div>}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={closeEnvGroupDialog} disabled={Boolean(workingKey)}><X className="h-4 w-4" />取消</Button>
            <Button variant="primary" onClick={() => void saveEnvGroup()} disabled={workingKey === "save-env-group"}><Check className="h-4 w-4" />保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EnvSwitch({
  checked,
  disabled,
  onClick,
}: {
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-accent" : "border border-border bg-bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
          checked ? "left-4" : "left-0.5",
        )}
      />
    </button>
  );
}

function assertAction(result: { success: boolean; error: string | null }) {
  if (!result.success) throw new Error(result.error || "终端操作失败");
}

function formatStartedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function unique(items: string[]) {
  return Array.from(new Set(items));
}

function normalizeWindowsPath(path: string) {
  return path.replace(/\//g, "\\");
}

function projectNameFromPath(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || "终端项目";
}

function isAbsoluteWindowsPath(path: string) {
  return /^[A-Za-z]:\\/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path);
}

function emptyVarRow(): EnvVarDraft {
  return { rowId: createId("env-var"), key: "", value: "" };
}

function mergeTerminalEnv(groups: TerminalEnvGroup[], activeIds: string[]): TerminalEnvVar[] {
  const active = new Set(activeIds);
  const merged: TerminalEnvVar[] = [];
  const index = new Map<string, number>();
  for (const group of groups) {
    if (!active.has(group.id)) continue;
    for (const variable of group.variables) {
      const lookup = variable.key.toUpperCase();
      const existing = index.get(lookup);
      if (existing === undefined) {
        index.set(lookup, merged.length);
        merged.push(variable);
      } else {
        merged[existing] = variable;
      }
    }
  }
  return merged;
}
