import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/Button";
import { AppHeader } from "@/components/AppHeader";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { EmptyState as BaseEmptyState } from "@/components/ui/EmptyState";
import { OpenWithButton } from "@/components/OpenWithButton";
import { Select } from "@/components/ui/Select";
import {
  tauri,
  type HBuilderXAppResourcePlatform,
  type HBuilderXBrowser,
  type HBuilderXProjectGroup,
  type HBuilderXProject,
  type HBuilderXPublishAppResourceConfig,
  type HBuilderXPublishMpAlipayConfig,
  type HBuilderXPublishResult,
  type HBuilderXRunExitEvent,
  type HBuilderXRunLogEvent,
  type HBuilderXRunResult,
  type HBuilderXRunState,
  type HBuilderXRunWebConfig,
  type Settings,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Download,
  FileUp,
  Folder,
  FolderPlus,
  FolderOpen,
  GripVertical,
  Loader2,
  Play,
  Plus,
  Rocket,
  Settings as SettingsIcon,
  Terminal,
  Trash2,
  Upload,
  Square,
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

type CliTab = "run" | "publish";
type RunPlatform = "app" | "web" | "mini";
type PublishPlatform =
  | "cloud-app"
  | "local-app-resource"
  | "harmony-local"
  | "harmony-resource"
  | "wgt"
  | "web"
  | "mp-alipay"
  | "mini"
  | "harmony-serverless";

const runPlatforms: Array<{ id: RunPlatform; label: string; enabled: boolean }> = [
  { id: "app", label: "uni-app / uni-app x 运行 - 手机或模拟器", enabled: false },
  { id: "web", label: "uni-app / uni-app x 运行 - WEB", enabled: true },
  { id: "mini", label: "uni-app / uni-app x 运行 - 小程序", enabled: false },
];

const publishPlatforms: Array<{ id: PublishPlatform; label: string; enabled: boolean }> = [
  { id: "cloud-app", label: "uni-app / uni-app x 发行 - Android/iOS 云打包", enabled: false },
  { id: "local-app-resource", label: "uni-app / uni-app x 发行 - App 生成本地打包资源", enabled: true },
  { id: "harmony-local", label: "uni-app / uni-app x 发行 - 鸿蒙本地打包", enabled: false },
  { id: "harmony-resource", label: "uni-app / uni-app x 发行 - 鸿蒙生成本地打包资源", enabled: false },
  { id: "wgt", label: "uni-app / uni-app x 发行 - App 制作应用 wgt 包", enabled: false },
  { id: "web", label: "uni-app / uni-app x 发行 - WEB", enabled: false },
  { id: "mp-alipay", label: "uni-app 发行 - 支付宝小程序", enabled: true },
  { id: "mini", label: "uni-app / uni-app x 发行 - 小程序", enabled: false },
  { id: "harmony-serverless", label: "uni-app / uni-app x 发行 - 鸿蒙无服务打包", enabled: false },
];

const browsers: HBuilderXBrowser[] = ["Built", "Chrome", "Firefox", "Ie", "Edge", "Safari"];
const appResourcePlatforms: HBuilderXAppResourcePlatform[] = ["APP", "app-android", "app-ios"];

interface LiveRunLog {
  stdout: string;
  stderr: string;
}

const UNGROUPED_SECTION_ID = "hbx-ungrouped-projects";

interface ProjectSection {
  id: string;
  name: string;
  projectIds: string[];
  builtin: boolean;
  collapsed: boolean;
}

export function HBuilderXCliPage({ onOpenSettings }: Props) {
  const { settings, saveSettings } = useApp();
  const [tab, setTab] = useState<CliTab>("run");
  const [runPlatform, setRunPlatform] = useState<RunPlatform>("web");
  const [publishPlatform, setPublishPlatform] = useState<PublishPlatform>("local-app-resource");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());
  const [stoppedIds, setStoppedIds] = useState<Set<string>>(new Set());
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<Record<string, HBuilderXRunResult>>({});
  const [publishResult, setPublishResult] = useState<Record<string, HBuilderXPublishResult>>({});
  const [liveLogs, setLiveLogs] = useState<Record<string, LiveRunLog>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [activeDragProjectId, setActiveDragProjectId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [hiddenSectionIds, setHiddenSectionIds] = useState<Set<string>>(new Set());

  if (!settings) return null;

  const currentSettings = settings;
  const projects = currentSettings.hbuilderx_projects;
  const projectSections = useMemo(
    () =>
      buildProjectSections(
        projects,
        currentSettings.hbuilderx_project_groups ?? [],
      ),
    [projects, currentSettings.hbuilderx_project_groups],
  );
  const orderedProjectIds = useMemo(
    () => projectSections.flatMap((section) => section.projectIds),
    [projectSections],
  );
  const visibleProjectSections = useMemo(
    () => projectSections.filter((section) => !hiddenSectionIds.has(section.id)),
    [hiddenSectionIds, projectSections],
  );
  const visibleProjectIds = useMemo(
    () => visibleProjectSections.flatMap((section) => section.projectIds),
    [visibleProjectSections],
  );
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const activeDragProject = activeDragProjectId
    ? projectById.get(activeDragProjectId) ?? null
    : null;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const projectsRef = useRef<HBuilderXProject[]>(projects);
  const activeProject = useMemo(
    () =>
      projects.find((project) => project.id === activeProjectId) ??
      projectById.get(visibleProjectIds[0] ?? orderedProjectIds[0] ?? "") ??
      null,
    [activeProjectId, orderedProjectIds, projectById, projects, visibleProjectIds],
  );

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    const sectionIds = new Set(projectSections.map((section) => section.id));
    setHiddenSectionIds((items) => {
      const next = new Set([...items].filter((id) => sectionIds.has(id)));
      return next.size === items.size ? items : next;
    });
  }, [projectSections]);

  useEffect(() => {
    let disposed = false;
    void tauri
      .getHBuilderXWebRuns()
      .then((states) => {
        if (!disposed) applyExistingWebRuns(states);
      })
      .catch((e) => {
        if (!disposed) setMessage(String(e));
      });
    return () => {
      disposed = true;
    };
  }, [projects]);

  useEffect(() => {
    let disposed = false;
    let unlistenLog: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    void tauri.onHBuilderXRunLog((event) => {
      if (disposed) return;
      appendRunLog(event);
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlistenLog = fn;
      }
    });
    void tauri.onHBuilderXRunExit((event) => {
      if (disposed) return;
      finishRun(event);
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlistenExit = fn;
      }
    });
    return () => {
      disposed = true;
      unlistenLog?.();
      unlistenExit?.();
    };
  }, []);

  function applyExistingWebRuns(states: HBuilderXRunState[]) {
    const projectByPath = new Map(
      projectsRef.current.map((project) => [normalizePathKey(project.path), project]),
    );
    const snapshots: Array<{ project: HBuilderXProject; state: HBuilderXRunState }> = [];
    for (const state of states) {
      const project = projectByPath.get(normalizePathKey(state.project_path));
      if (project) snapshots.push({ project, state });
    }

    const runningProjectIds = new Set(
      snapshots
        .filter(({ state }) => state.running)
        .map(({ project }) => project.id),
    );
    setRunningIds(runningProjectIds);
    setStoppingIds((items) => {
      const next = new Set(items);
      for (const id of [...next]) {
        if (!runningProjectIds.has(id)) next.delete(id);
      }
      return next;
    });
    setLiveLogs((items) => {
      const next = { ...items };
      for (const { project, state } of snapshots) {
        if (state.running || state.stdout || state.stderr) {
          next[project.id] = { stdout: state.stdout, stderr: state.stderr };
        }
      }
      return next;
    });
    setResult((items) => {
      const next = { ...items };
      for (const { project, state } of snapshots) {
        if (state.success !== null) {
          next[project.id] = {
            success: state.success,
            exit_code: state.exit_code,
            stdout: state.stdout,
            stderr: state.stderr,
            command: state.command,
            error: state.error,
          };
        }
      }
      return next;
    });
    setActiveProjectId((id) => {
      if (id && projectsRef.current.some((project) => project.id === id)) return id;
      return snapshots[0]?.project.id ?? id;
    });
  }

  async function updateSettings(patch: Partial<Settings>) {
    await saveSettings({ ...currentSettings, ...patch });
  }

  async function updateProjectSections(nextSections: ProjectSection[]) {
    const nextGroups = nextSections
      .filter((section) => !section.builtin)
      .map((section) => ({
        id: section.id,
        name: section.name,
        project_ids: section.projectIds,
        collapsed: section.collapsed,
      }));
    const nextProjectIds = nextSections.flatMap((section) => section.projectIds);
    const nextProjects = nextProjectIds
      .map((id) => projectById.get(id))
      .filter((project): project is HBuilderXProject => Boolean(project));
    await updateSettings({
      hbuilderx_project_groups: nextGroups,
      hbuilderx_projects: nextProjects,
    });
  }

  function toggleSectionVisibility(sectionId: string) {
    setHiddenSectionIds((items) => {
      const next = new Set(items);
      next.has(sectionId) ? next.delete(sectionId) : next.add(sectionId);
      return next;
    });
  }

  async function addGroup() {
    const group: HBuilderXProjectGroup = {
      id: `hbx-group-${Date.now()}`,
      name: `分组 ${projectSections.filter((section) => !section.builtin).length + 1}`,
      project_ids: [],
      collapsed: false,
    };
    await updateSettings({
      hbuilderx_project_groups: [
        ...projectSections
          .filter((section) => !section.builtin)
          .map((section) => ({
            id: section.id,
            name: section.name,
            project_ids: section.projectIds,
            collapsed: section.collapsed,
          })),
        group,
      ],
    });
    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
  }

  async function renameGroup(groupId: string, name: string) {
    const nextName = name.trim() || "分组";
    await updateSettings({
      hbuilderx_project_groups: projectSections
        .filter((section) => !section.builtin)
        .map((section) => ({
          id: section.id,
          name: section.id === groupId ? nextName : section.name,
          project_ids: section.projectIds,
          collapsed: section.collapsed,
        })),
    });
    setEditingGroupId(null);
    setEditingGroupName("");
  }

  async function toggleGroup(groupId: string) {
    await updateSettings({
      hbuilderx_project_groups: projectSections
        .filter((section) => !section.builtin)
        .map((section) => ({
          id: section.id,
          name: section.name,
          project_ids: section.projectIds,
          collapsed: section.id === groupId ? !section.collapsed : section.collapsed,
        })),
    });
  }

  async function removeGroup(groupId: string) {
    await updateSettings({
      hbuilderx_project_groups: projectSections
        .filter((section) => !section.builtin && section.id !== groupId)
        .map((section) => ({
          id: section.id,
          name: section.name,
          project_ids: section.projectIds,
          collapsed: section.collapsed,
        })),
    });
  }

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    setActiveDragProjectId(projectById.has(id) ? id : null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    setActiveDragProjectId(null);
    if (!overId || activeId === overId) return;

    const sourceSectionId = findSectionIdByProject(projectSections, activeId);
    const targetSectionId = isSectionId(projectSections, overId)
      ? overId
      : findSectionIdByProject(projectSections, overId);
    if (!sourceSectionId || !targetSectionId) return;

    const nextSections = projectSections.map((section) => ({
      ...section,
      projectIds: [...section.projectIds],
    }));
    const sourceSection = nextSections.find((section) => section.id === sourceSectionId);
    const targetSection = nextSections.find((section) => section.id === targetSectionId);
    if (!sourceSection || !targetSection) return;

    if (sourceSection.id === targetSection.id) {
      const oldIndex = sourceSection.projectIds.indexOf(activeId);
      const newIndex = isSectionId(projectSections, overId)
        ? sourceSection.projectIds.length - 1
        : sourceSection.projectIds.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      sourceSection.projectIds = arrayMove(sourceSection.projectIds, oldIndex, newIndex);
      void updateProjectSections(nextSections);
      return;
    }

    const activeIndex = sourceSection.projectIds.indexOf(activeId);
    if (activeIndex < 0) return;
    sourceSection.projectIds.splice(activeIndex, 1);
    const overIndex = isSectionId(projectSections, overId)
      ? targetSection.projectIds.length
      : targetSection.projectIds.indexOf(overId);
    targetSection.projectIds.splice(Math.max(overIndex, 0), 0, activeId);
    targetSection.collapsed = false;
    void updateProjectSections(nextSections);
  }

  async function pickCliDir() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "选择 HBuilderX CLI 所在文件夹",
    });
    if (!picked || typeof picked !== "string") return;
    await updateSettings({ hbuilderx_cli_dir: picked });
  }

  async function addProject() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "选择 uni-app 项目文件夹",
    });
    if (!picked || typeof picked !== "string") return;
    const name = baseName(picked) || "uni-app 项目";
    const project: HBuilderXProject = {
      id: `hbx-${Date.now()}`,
      name,
      path: picked,
      run: { web: defaultRunWebConfig() },
      publish: {
        web: {},
        app_resource: defaultPublishAppResourceConfig(),
        mp_alipay: defaultPublishMpAlipayConfig(),
      },
    };
    await updateSettings({
      hbuilderx_projects: [...currentSettings.hbuilderx_projects, project],
    });
    setActiveProjectId(project.id);
  }

  async function rebindProject(project: HBuilderXProject) {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: project.path,
      title: "重新选择项目文件夹",
    });
    if (!picked || typeof picked !== "string") return;
    await updateProject(project.id, { path: picked });
  }

  async function updateProject(id: string, patch: Partial<HBuilderXProject>) {
    await updateSettings({
      hbuilderx_projects: currentSettings.hbuilderx_projects.map((project) =>
        project.id === id ? { ...project, ...patch } : project,
      ),
    });
  }

  async function updateRunWeb(id: string, patch: Partial<HBuilderXRunWebConfig>) {
    await updateSettings({
      hbuilderx_projects: currentSettings.hbuilderx_projects.map((project) =>
        project.id === id
          ? {
              ...project,
              run: { ...project.run, web: { ...project.run.web, ...patch } },
            }
          : project,
      ),
    });
  }

  async function updatePublishAppResource(
    id: string,
    patch: Partial<HBuilderXPublishAppResourceConfig>,
  ) {
    await updateSettings({
      hbuilderx_projects: currentSettings.hbuilderx_projects.map((project) =>
        project.id === id
          ? {
              ...project,
              publish: {
                ...project.publish,
                app_resource: {
                  ...defaultPublishAppResourceConfig(),
                  ...project.publish.app_resource,
                  ...patch,
                },
              },
            }
          : project,
      ),
    });
  }

  async function updatePublishMpAlipay(
    id: string,
    patch: Partial<HBuilderXPublishMpAlipayConfig>,
  ) {
    await updateSettings({
      hbuilderx_projects: currentSettings.hbuilderx_projects.map((project) =>
        project.id === id
          ? {
              ...project,
              publish: {
                ...project.publish,
                mp_alipay: {
                  ...defaultPublishMpAlipayConfig(),
                  ...project.publish.mp_alipay,
                  ...patch,
                },
              },
            }
          : project,
      ),
    });
  }

  async function removeProject(id: string) {
    await updateSettings({
      hbuilderx_projects: currentSettings.hbuilderx_projects.filter((project) => project.id !== id),
      hbuilderx_project_groups: projectSections
        .filter((section) => !section.builtin)
        .map((section) => ({
          id: section.id,
          name: section.name,
          project_ids: section.projectIds.filter((projectId) => projectId !== id),
          collapsed: section.collapsed,
        })),
    });
    if (activeProjectId === id) setActiveProjectId(null);
  }



  async function copyCommand(project: HBuilderXProject) {
    try {
      const preview = await tauri.previewHBuilderXRunWeb({
        cli_dir: currentSettings.hbuilderx_cli_dir,
        project_path: project.path,
        options: project.run.web,
      });
      await navigator.clipboard.writeText(preview.command);
      setMessage("命令已复制");
    } catch (e) {
      setMessage(String(e));
    }
  }

  async function copyPublishAppResourceCommand(project: HBuilderXProject) {
    try {
      const preview = await tauri.previewHBuilderXPublishAppResource({
        cli_dir: currentSettings.hbuilderx_cli_dir,
        project_path: project.path,
        options: {
          ...defaultPublishAppResourceConfig(),
          ...project.publish.app_resource,
        },
      });
      await navigator.clipboard.writeText(preview.command);
      setMessage("发行命令已复制");
    } catch (e) {
      setMessage(String(e));
    }
  }

  async function copyPublishMpAlipayCommand(project: HBuilderXProject) {
    try {
      const preview = await tauri.previewHBuilderXPublishMpAlipay({
        cli_dir: currentSettings.hbuilderx_cli_dir,
        project_path: project.path,
        options: {
          ...defaultPublishMpAlipayConfig(),
          ...project.publish.mp_alipay,
        },
      });
      await navigator.clipboard.writeText(preview.command);
      setMessage("发行命令已复制");
    } catch (e) {
      setMessage(String(e));
    }
  }

  async function runWeb(project: HBuilderXProject) {
    setRunningIds((items) => new Set(items).add(project.id));
    setStoppingIds((items) => {
      const nextItems = new Set(items);
      nextItems.delete(project.id);
      return nextItems;
    });
    setStoppedIds((items) => {
      const nextItems = new Set(items);
      nextItems.delete(project.id);
      return nextItems;
    });
    setMessage(null);
    setResult((items) => {
      const next = { ...items };
      delete next[project.id];
      return next;
    });
    setLiveLogs((items) => ({
      ...items,
      [project.id]: { stdout: "", stderr: "" },
    }));
    try {
      const next = await tauri.runHBuilderXWeb({
        cli_dir: currentSettings.hbuilderx_cli_dir,
        project_path: project.path,
        options: project.run.web,
      });
      if (next.error) {
        setResult((items) => ({ ...items, [project.id]: next }));
        setRunningIds((items) => {
          const nextItems = new Set(items);
          nextItems.delete(project.id);
          return nextItems;
        });
      }
    } catch (e) {
      setResult((items) => ({
        ...items,
        [project.id]: {
          success: false,
          exit_code: null,
          stdout: "",
          stderr: "",
          command: "",
          error: String(e),
        },
      }));
      setRunningIds((items) => {
        const nextItems = new Set(items);
        nextItems.delete(project.id);
        return nextItems;
      });
    }
  }

  async function publishAppResource(project: HBuilderXProject) {
    setPublishingIds((items) => new Set(items).add(project.id));
    setMessage(null);
    setPublishResult((items) => {
      const next = { ...items };
      delete next[project.id];
      return next;
    });
    try {
      const next = await tauri.runHBuilderXPublishAppResource({
        cli_dir: currentSettings.hbuilderx_cli_dir,
        project_path: project.path,
        options: {
          ...defaultPublishAppResourceConfig(),
          ...project.publish.app_resource,
        },
      });
      setPublishResult((items) => ({ ...items, [project.id]: next }));
      setMessage(next.success ? "发行完成" : next.error ?? "发行失败");
    } catch (e) {
      setPublishResult((items) => ({
        ...items,
        [project.id]: {
          success: false,
          command_success: false,
          exit_code: null,
          stdout: "",
          stderr: "",
          command: "",
          error: String(e),
          copy_result: null,
        },
      }));
      setMessage(String(e));
    } finally {
      setPublishingIds((items) => {
        const nextItems = new Set(items);
        nextItems.delete(project.id);
        return nextItems;
      });
    }
  }

  async function publishMpAlipay(project: HBuilderXProject) {
    setPublishingIds((items) => new Set(items).add(project.id));
    setMessage(null);
    setPublishResult((items) => {
      const next = { ...items };
      delete next[project.id];
      return next;
    });
    try {
      const next = await tauri.runHBuilderXPublishMpAlipay({
        cli_dir: currentSettings.hbuilderx_cli_dir,
        project_path: project.path,
        options: {
          ...defaultPublishMpAlipayConfig(),
          ...project.publish.mp_alipay,
        },
      });
      setPublishResult((items) => ({ ...items, [project.id]: next }));
      setMessage(next.success ? "发行完成" : next.error ?? "发行失败");
    } catch (e) {
      setPublishResult((items) => ({
        ...items,
        [project.id]: {
          success: false,
          command_success: false,
          exit_code: null,
          stdout: "",
          stderr: "",
          command: "",
          error: String(e),
          copy_result: null,
        },
      }));
      setMessage(String(e));
    } finally {
      setPublishingIds((items) => {
        const nextItems = new Set(items);
        nextItems.delete(project.id);
        return nextItems;
      });
    }
  }

  async function stopWeb(project: HBuilderXProject) {
    setStoppingIds((items) => new Set(items).add(project.id));
    setMessage(null);
    try {
      const stopped = await tauri.stopHBuilderXWeb({ project_path: project.path });
      if (stopped.success) {
        setMessage(`已发送停止请求${stopped.pid ? `，PID: ${stopped.pid}` : ""}`);
        setStoppedIds((items) => new Set(items).add(project.id));
      } else {
        setMessage(stopped.error ?? "停止失败");
        setStoppingIds((items) => {
          const nextItems = new Set(items);
          nextItems.delete(project.id);
          return nextItems;
        });
      }
    } catch (e) {
      setMessage(String(e));
      setStoppingIds((items) => {
        const nextItems = new Set(items);
        nextItems.delete(project.id);
        return nextItems;
      });
    }
  }

  function appendRunLog(event: HBuilderXRunLogEvent) {
    setLiveLogs((items) => {
      const project = projectsRef.current.find(
        (item) => samePath(item.path, event.project_path),
      );
      if (!project) return items;
      const current = items[project.id] ?? { stdout: "", stderr: "" };
      const key = event.stream === "stderr" ? "stderr" : "stdout";
      return {
        ...items,
        [project.id]: {
          ...current,
          [key]: current[key] + event.line,
        },
      };
    });
  }

  function finishRun(event: HBuilderXRunExitEvent) {
    const project = projectsRef.current.find((item) => samePath(item.path, event.project_path));
    if (!project) return;
    setResult((items) => ({
      ...items,
      [project.id]: {
        success: event.success,
        exit_code: event.exit_code,
        stdout: event.stdout,
        stderr: event.stderr,
        command: event.command,
        error: event.error,
      },
    }));
    setLiveLogs((items) => ({
      ...items,
      [project.id]: { stdout: event.stdout, stderr: event.stderr },
    }));
    setRunningIds((items) => {
      const nextItems = new Set(items);
      nextItems.delete(project.id);
      return nextItems;
    });
    setStoppingIds((items) => {
      const nextItems = new Set(items);
      nextItems.delete(project.id);
      return nextItems;
    });
  }

  async function exportConfig(projectId?: string) {
    const path = await saveDialog({
      title: "导出 HBuilderX CLI 配置",
      defaultPath: projectId ? "hbuilderx-cli-project.json" : "hbuilderx-cli-config.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path || typeof path !== "string") return;
    await tauri.exportHBuilderXCliConfig(path, projectId ? [projectId] : null);
    setMessage("配置已导出");
  }

  async function importConfig() {
    const path = await openDialog({
      title: "导入 HBuilderX CLI 配置",
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path || typeof path !== "string") return;
    const next = await tauri.importHBuilderXCliConfig(path);
    await saveSettings(next);
    setMessage("配置已导入");
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg text-fg">
      <AppHeader
        title="HBuilderX CLI"
        subtitle="快捷运行和发行 uni-app 项目"
        onOpenSettings={onOpenSettings}
        rightActions={
          <>
            <Button variant="outline" size="sm" onClick={() => void importConfig()}>
              <FileUp className="h-3.5 w-3.5" />
              导入
            </Button>
            <Button variant="outline" size="sm" onClick={() => void exportConfig()}>
              <Download className="h-3.5 w-3.5" />
              全部导出
            </Button>
          </>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[320px_1fr]">
        <aside className="flex min-h-0 flex-col border-r border-border bg-bg-subtle">
          <section className="border-b border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">CLI 文件夹</h2>
              <Button variant="ghost" size="sm" onClick={pickCliDir}>
                <FolderOpen className="h-3.5 w-3.5" />
                选择
              </Button>
            </div>
            <Input
      value={currentSettings.hbuilderx_cli_dir}
              onChange={(ev) => void updateSettings({ hbuilderx_cli_dir: ev.target.value })}
              placeholder="例如 D:\\HBuilderX"
              className="font-mono text-xs"
            />
            <p className="mt-2 text-xs text-fg-muted">填写 `cli.exe` 所在文件夹，不是 exe 文件本身。</p>
          </section>

          <section className="flex min-h-0 flex-1 flex-col p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">项目</h2>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => void addGroup()}>
                  <FolderPlus className="h-3.5 w-3.5" />
                  分组
                </Button>
                <Button variant="primary" size="sm" onClick={addProject}>
                  <Plus className="h-3.5 w-3.5" />
                  添加
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {projects.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-fg-muted">
                  添加项目文件夹后开始配置运行命令
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCorners}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={() => setActiveDragProjectId(null)}
                >
                  <ProjectGroupFilter
                    sections={projectSections}
                    hiddenSectionIds={hiddenSectionIds}
                    onToggle={toggleSectionVisibility}
                  />
                  <div className="flex flex-col gap-2">
                    {visibleProjectSections.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-fg-muted">
                        没有显示中的分组
                      </div>
                    ) : visibleProjectSections.map((section) => (
                      <ProjectGroupSection
                        key={section.id}
                        section={section}
                        projects={section.projectIds
                          .map((id) => projectById.get(id))
                          .filter((project): project is HBuilderXProject => Boolean(project))}
                        activeProjectId={activeProject?.id ?? null}
                        showHeader={projectSections.length > 1 || !section.builtin}
                        editingGroupId={editingGroupId}
                        editingGroupName={editingGroupName}
                        onSelect={setActiveProjectId}
                        onStartEdit={(group) => {
                          setEditingGroupId(group.id);
                          setEditingGroupName(group.name);
                        }}
                        onEditingNameChange={setEditingGroupName}
                        onCommitEdit={(groupId) => void renameGroup(groupId, editingGroupName)}
                        onCancelEdit={() => {
                          setEditingGroupId(null);
                          setEditingGroupName("");
                        }}
                        onToggle={toggleGroup}
                        onRemove={removeGroup}
                      />
                    ))}
                  </div>
                  <DragOverlay>
                    {activeDragProject ? (
                      <ProjectListCard
                        project={activeDragProject}
                        active={activeProject?.id === activeDragProject.id}
                        overlay
                      />
                    ) : null}
                  </DragOverlay>
                </DndContext>
              )}
            </div>
          </section>
        </aside>

        <section className="min-h-0 overflow-auto p-5">
          <div className="mx-auto flex max-w-5xl flex-col gap-5">
            <div className="flex items-center gap-2">
              <Segment active={tab === "run"} onClick={() => setTab("run")}>
                <Play className="h-4 w-4" />
                运行
              </Segment>
              <Segment active={tab === "publish"} onClick={() => setTab("publish")}>
                <Rocket className="h-4 w-4" />
                发行
              </Segment>
              {message && <span className="ml-auto text-xs text-fg-muted">{message}</span>}
            </div>

            {tab === "run" ? (
              <>
                <Panel title="运行平台">
                  <div className="grid gap-2 md:grid-cols-3">
                    {runPlatforms.map((platform) => (
                      <PlatformButton
                        key={platform.id}
                        active={runPlatform === platform.id}
                        disabled={!platform.enabled}
                        label={platform.label}
                        onClick={() => {
                          if (!platform.enabled) {
                            setMessage("暂未实现");
                            return;
                          }
                          setRunPlatform(platform.id);
                        }}
                      />
                    ))}
                  </div>
                </Panel>
                {runPlatform === "web" && activeProject ? (
                  <ProjectRunWebCard
                    project={activeProject}
                    cliDir={currentSettings.hbuilderx_cli_dir}
                    running={runningIds.has(activeProject.id)}
                    stopping={stoppingIds.has(activeProject.id)}
                    stopped={stoppedIds.has(activeProject.id)}
                    result={result[activeProject.id]}
                    liveLog={liveLogs[activeProject.id]}
                    onUpdateProject={updateProject}
                    onUpdateRunWeb={updateRunWeb}
                    onRemove={removeProject}
                    onRebind={rebindProject}
                    onCopy={copyCommand}
                    onRun={runWeb}
                    onStop={stopWeb}
                    onExport={exportConfig}
                    onError={setMessage}
                  />
                ) : (
                  <EmptyState text="请选择或添加一个项目，配置并执行 uni-app 运行或发行命令" onAdd={addProject} />
                )}
              </>
            ) : (
              <>
                <Panel title="发行平台">
                  <div className="grid gap-2 md:grid-cols-2">
                    {publishPlatforms.map((platform) => (
                      <PlatformButton
                        key={platform.id}
                        active={publishPlatform === platform.id}
                        disabled={!platform.enabled}
                        label={platform.label}
                        onClick={() => {
                          if (!platform.enabled) {
                            setMessage("暂未实现");
                            return;
                          }
                          setPublishPlatform(platform.id);
                        }}
                      />
                    ))}
                  </div>
                </Panel>
                {publishPlatform === "local-app-resource" && activeProject ? (
                  <ProjectPublishAppResourceCard
                    project={activeProject}
                    cliDir={currentSettings.hbuilderx_cli_dir}
                    publishing={publishingIds.has(activeProject.id)}
                    result={publishResult[activeProject.id]}
                    onUpdateProject={updateProject}
                    onUpdatePublishAppResource={updatePublishAppResource}
                    onRemove={removeProject}
                    onRebind={rebindProject}
                    onCopy={copyPublishAppResourceCommand}
                    onPublish={publishAppResource}
                    onExport={exportConfig}
                    onError={setMessage}
                  />
                ) : publishPlatform === "mp-alipay" && activeProject ? (
                  <ProjectPublishMpAlipayCard
                    project={activeProject}
                    cliDir={currentSettings.hbuilderx_cli_dir}
                    publishing={publishingIds.has(activeProject.id)}
                    result={publishResult[activeProject.id]}
                    onUpdateProject={updateProject}
                    onUpdatePublishMpAlipay={updatePublishMpAlipay}
                    onRemove={removeProject}
                    onRebind={rebindProject}
                    onCopy={copyPublishMpAlipayCommand}
                    onPublish={publishMpAlipay}
                    onExport={exportConfig}
                    onError={setMessage}
                  />
                ) : (
                  <EmptyState text="请选择或添加一个项目" />
                )}
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function ProjectGroupFilter({
  sections,
  hiddenSectionIds,
  onToggle,
}: {
  sections: ProjectSection[];
  hiddenSectionIds: Set<string>;
  onToggle: (sectionId: string) => void;
}) {
  return (
    <div className="mb-2 rounded-lg border border-border bg-bg/50 p-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
        <Folder className="h-3.5 w-3.5" />
        分组显示
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sections.map((section) => {
          const visible = !hiddenSectionIds.has(section.id);
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onToggle(section.id)}
              className={cn(
                "inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs transition",
                visible
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-bg text-fg-subtle opacity-70 hover:opacity-100",
              )}
              title={visible ? "点击隐藏这个分组" : "点击显示这个分组"}
            >
              <span className="truncate">{section.name}</span>
              <span className="shrink-0 text-[10px] opacity-80">{section.projectIds.length}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProjectGroupSection({
  section,
  projects,
  activeProjectId,
  showHeader,
  editingGroupId,
  editingGroupName,
  onSelect,
  onStartEdit,
  onEditingNameChange,
  onCommitEdit,
  onCancelEdit,
  onToggle,
  onRemove,
}: {
  section: ProjectSection;
  projects: HBuilderXProject[];
  activeProjectId: string | null;
  showHeader: boolean;
  editingGroupId: string | null;
  editingGroupName: string;
  onSelect: (id: string) => void;
  onStartEdit: (group: ProjectSection) => void;
  onEditingNameChange: (name: string) => void;
  onCommitEdit: (groupId: string) => void;
  onCancelEdit: () => void;
  onToggle: (groupId: string) => Promise<void>;
  onRemove: (groupId: string) => Promise<void>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: section.id });
  const isEditing = editingGroupId === section.id;
  const isEmpty = projects.length === 0;

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "rounded-lg border transition",
        showHeader ? "border-border bg-bg/60" : "border-transparent",
        isOver && "border-accent bg-accent/5",
      )}
    >
      {showHeader && (
        <div className="flex min-h-9 items-center gap-1.5 px-2 py-1.5">
          {!section.builtin ? (
            <button
              type="button"
              className="rounded p-1 text-fg-muted hover:bg-bg-muted hover:text-fg"
              onClick={() => void onToggle(section.id)}
              title={section.collapsed ? "展开分组" : "折叠分组"}
            >
              {section.collapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <span className="h-5 w-5" />
          )}
          {isEditing ? (
            <Input
              autoFocus
              value={editingGroupName}
              onChange={(event) => onEditingNameChange(event.target.value)}
              onBlur={() => onCommitEdit(section.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onCommitEdit(section.id);
                if (event.key === "Escape") onCancelEdit();
              }}
              className="h-7 min-w-0 flex-1 px-2 text-xs"
            />
          ) : (
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-fg-muted"
              onDoubleClick={() => !section.builtin && onStartEdit(section)}
            >
              {section.name}
              <span className="ml-1 font-normal text-fg-subtle">{projects.length}</span>
            </button>
          )}
          {!section.builtin && !isEditing && (
            <>
              <button
                type="button"
                className="rounded p-1 text-fg-subtle hover:bg-bg-muted hover:text-fg"
                onClick={() => onStartEdit(section)}
                title="重命名分组"
              >
                <SettingsIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="rounded p-1 text-fg-subtle hover:bg-danger/10 hover:text-danger"
                onClick={() => void onRemove(section.id)}
                title="删除分组"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      )}
      {!section.collapsed && (
        <SortableContext
          items={section.projectIds}
          strategy={verticalListSortingStrategy}
        >
          <div className={cn("flex flex-col gap-2", showHeader && "p-2 pt-0")}>
            {projects.map((project) => (
              <SortableProjectCard
                key={project.id}
                project={project}
                active={activeProjectId === project.id}
                onSelect={onSelect}
              />
            ))}
            {isEmpty && showHeader && (
              <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-fg-subtle">
                拖入项目
              </div>
            )}
          </div>
        </SortableContext>
      )}
    </section>
  );
}

function SortableProjectCard({
  project,
  active,
  onSelect,
}: {
  project: HBuilderXProject;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ProjectListCard
        project={project}
        active={active}
        dragging={isDragging}
        onSelect={onSelect}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

function ProjectListCard({
  project,
  active,
  dragging,
  overlay,
  onSelect,
  dragHandleProps,
}: {
  project: HBuilderXProject;
  active: boolean;
  dragging?: boolean;
  overlay?: boolean;
  onSelect?: (id: string) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
}) {
  return (
    <div
      className={cn(
        "flex items-stretch rounded-lg border bg-bg text-left transition",
        active ? "border-accent bg-accent/10" : "border-border hover:border-border-strong",
        dragging && "opacity-40",
        overlay && "w-72 border-accent bg-bg shadow-xl",
      )}
    >
      {!overlay && (
        <button
          type="button"
          className="flex w-8 shrink-0 cursor-grab items-center justify-center rounded-l-lg text-fg-subtle hover:bg-bg-muted hover:text-fg active:cursor-grabbing"
          title="拖拽排序或移动分组"
          {...dragHandleProps}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        onClick={() => onSelect?.(project.id)}
        className="min-w-0 flex-1 rounded-r-lg px-2.5 py-2.5 text-left"
      >
        <div className="truncate text-sm font-semibold">{project.name || "未命名项目"}</div>
        <div className="mt-1 truncate font-mono text-xs text-fg-muted">{project.path}</div>
      </button>
    </div>
  );
}

function ProjectRunWebCard({
  project,
  cliDir,
  running,
  stopping,
  stopped,
  result,
  liveLog,
  onUpdateProject,
  onUpdateRunWeb,
  onRemove,
  onRebind,
  onCopy,
  onRun,
  onStop,
  onExport,
  onError,
}: {
  project: HBuilderXProject;
  cliDir: string;
  running: boolean;
  stopping: boolean;
  stopped: boolean;
  result?: HBuilderXRunResult;
  liveLog?: LiveRunLog;
  onUpdateProject: (id: string, patch: Partial<HBuilderXProject>) => Promise<void>;
  onUpdateRunWeb: (id: string, patch: Partial<HBuilderXRunWebConfig>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onRebind: (project: HBuilderXProject) => Promise<void>;
  onCopy: (project: HBuilderXProject) => Promise<void>;
  onRun: (project: HBuilderXProject) => Promise<void>;
  onStop: (project: HBuilderXProject) => Promise<void>;
  onExport: (projectId: string) => Promise<void>;
  onError?: (message: string) => void;
}) {
  const command = buildDisplayCommand(cliDir, project.path, project.run.web);
  const canRun = Boolean(cliDir.trim() && project.path.trim()) && !running;
  const stdout = liveLog?.stdout ?? result?.stdout ?? "";
  const stderr = liveLog?.stderr ?? result?.stderr ?? "";
  const hasOutput = running || Boolean(result || stdout || stderr);

  return (
    <div className="flex flex-col gap-5">
      <Panel title="项目">
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <Field label="名称">
            <Input
              value={project.name}
              onChange={(ev) => void onUpdateProject(project.id, { name: ev.target.value })}
            />
          </Field>
          <Field label="项目路径">
            <div className="flex gap-2">
              <Input
                value={project.path}
                onChange={(ev) => void onUpdateProject(project.id, { path: ev.target.value })}
                className="font-mono text-xs"
              />
              <Button variant="outline" size="md" onClick={() => void onRebind(project)}>
                <FolderOpen className="h-4 w-4" />
                选择
              </Button>
            </div>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <OpenWithButton
            path={project.path}
            label="打开文件夹"
            onError={onError}
          />
          <Button variant="outline" size="sm" onClick={() => void onExport(project.id)}>
            <Upload className="h-3.5 w-3.5" />
            导出此项目
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void onRemove(project.id)}>
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </Button>
        </div>
      </Panel>

      <Panel title="运行 WEB 参数">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="浏览器">
            <Select
              value={project.run.web.browser}
              onChange={(ev) =>
                void onUpdateRunWeb(project.id, { browser: ev.target.value as HBuilderXBrowser })
              }
            >
              {browsers.map((browser) => (
                <option key={browser} value={browser}>
                  {browser}
                </option>
              ))}
            </Select>
          </Field>
          <ToggleField
            label="界面运行"
            checked={project.run.web.ui}
            onChange={(checked) => void onUpdateRunWeb(project.id, { ui: checked })}
          />
          <ToggleField
            label="编译模式"
            checked={project.run.web.compile}
            onChange={(checked) => void onUpdateRunWeb(project.id, { compile: checked })}
          />
          <ToggleField
            label="错误后继续"
            checked={project.run.web.continue_on_error}
            onChange={(checked) => void onUpdateRunWeb(project.id, { continue_on_error: checked })}
          />
        </div>
      </Panel>

      <Panel title="最终命令">
        <div className="rounded-lg border border-border bg-bg p-3 font-mono text-xs leading-6 text-fg">
          {command}
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void onCopy(project)}>
            <Clipboard className="h-3.5 w-3.5" />
            复制命令
          </Button>
          <Button variant="primary" size="sm" disabled={!canRun} onClick={() => void onRun(project)}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Terminal className="h-3.5 w-3.5" />}
            运行 WEB
          </Button>
          {running && (
            <Button variant="danger" size="sm" disabled={stopping} onClick={() => void onStop(project)}>
              {stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
              停止运行
            </Button>
          )}
        </div>
      </Panel>

      {hasOutput && (
        <Panel title="运行结果">
          <div className="mb-3 flex items-center gap-2 text-sm">
            {running ? (
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
              </span>
            ) : stopped ? (
              <Square className="h-4 w-4 text-fg-muted" />
            ) : result?.success ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <XCircle className="h-4 w-4 text-danger" />
            )}
            <span className={running ? "font-medium text-accent animate-pulse" : ""}>
              {running ? "任务运行中..." : stopped ? "已停止" : result?.success ? "执行成功" : "执行失败"}
            </span>
            <span className="text-xs text-fg-muted">退出码: {result?.exit_code ?? "无"}</span>
            {running && (
              <Button
                variant="danger"
                size="sm"
                className="ml-auto"
                disabled={stopping}
                onClick={() => void onStop(project)}
              >
                {stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                停止运行
              </Button>
            )}
          </div>
          {result?.error && <pre className="mb-2 whitespace-pre-wrap rounded bg-danger/10 p-2 text-xs text-danger">{result.error}</pre>}
          {(stdout || stderr) && (
            <Suspense fallback={<TerminalLogFallback />}>
              <TerminalLog stdout={stdout} stderr={stderr} />
            </Suspense>
          )}
          {running && !stdout && !stderr && (
            <div className="rounded border border-dashed border-border px-3 py-6 text-center text-xs text-fg-muted">
              正在等待 CLI 输出...
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

function ProjectPublishAppResourceCard({
  project,
  cliDir,
  publishing,
  result,
  onUpdateProject,
  onUpdatePublishAppResource,
  onRemove,
  onRebind,
  onCopy,
  onPublish,
  onExport,
  onError,
}: {
  project: HBuilderXProject;
  cliDir: string;
  publishing: boolean;
  result?: HBuilderXPublishResult;
  onUpdateProject: (id: string, patch: Partial<HBuilderXProject>) => Promise<void>;
  onUpdatePublishAppResource: (
    id: string,
    patch: Partial<HBuilderXPublishAppResourceConfig>,
  ) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onRebind: (project: HBuilderXProject) => Promise<void>;
  onCopy: (project: HBuilderXProject) => Promise<void>;
  onPublish: (project: HBuilderXProject) => Promise<void>;
  onExport: (projectId: string) => Promise<void>;
  onError?: (message: string) => void;
}) {
  const config = {
    ...defaultPublishAppResourceConfig(),
    ...project.publish.app_resource,
  };
  const command = buildPublishAppResourceDisplayCommand(cliDir, project.path, config);
  const copyReady =
    !config.copy_enabled ||
    Boolean(config.copy_source_dir.trim() && config.copy_target_dir.trim());
  const canPublish = Boolean(cliDir.trim() && project.path.trim() && copyReady) && !publishing;
  const stdout = result?.stdout ?? "";
  const stderr = result?.stderr ?? "";
  const hasOutput = publishing || Boolean(result || stdout || stderr);

  async function pickCopyDir(
    field: "copy_source_dir" | "copy_target_dir",
    title: string,
  ) {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: config[field],
      title,
    });
    if (!picked || typeof picked !== "string") return;
    await onUpdatePublishAppResource(project.id, { [field]: picked });
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel title="项目">
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <Field label="名称">
            <Input
              value={project.name}
              onChange={(ev) => void onUpdateProject(project.id, { name: ev.target.value })}
            />
          </Field>
          <Field label="项目路径">
            <div className="flex gap-2">
              <Input
                value={project.path}
                onChange={(ev) => void onUpdateProject(project.id, { path: ev.target.value })}
                className="font-mono text-xs"
              />
              <Button variant="outline" size="md" onClick={() => void onRebind(project)}>
                <FolderOpen className="h-4 w-4" />
                选择
              </Button>
            </div>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <OpenWithButton
            path={project.path}
            label="打开文件夹"
            onError={onError}
          />
          <Button variant="outline" size="sm" onClick={() => void onExport(project.id)}>
            <Upload className="h-3.5 w-3.5" />
            导出此项目
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void onRemove(project.id)}>
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </Button>
        </div>
      </Panel>

      <Panel title="App 本地打包资源参数">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="发行平台">
            <Select
              value={config.platform}
              onChange={(ev) =>
                void onUpdatePublishAppResource(project.id, {
                  platform: ev.target.value as HBuilderXAppResourcePlatform,
                })
              }
            >
              {appResourcePlatforms.map((platform) => (
                <option key={platform} value={platform}>
                  {platform === "APP" ? "APP（通用）" : platform}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Panel>

      <Panel title="执行后复制">
        <div className="grid gap-3">
          <ToggleField
            label="发行成功后复制"
            checked={config.copy_enabled}
            onChange={(checked) =>
              void onUpdatePublishAppResource(project.id, { copy_enabled: checked })
            }
          />
          {config.copy_enabled && (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="复制源文件夹">
                <div className="flex gap-2">
                  <Input
                    value={config.copy_source_dir}
                    onChange={(ev) =>
                      void onUpdatePublishAppResource(project.id, {
                        copy_source_dir: ev.target.value,
                      })
                    }
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() => void pickCopyDir("copy_source_dir", "选择复制源文件夹")}
                  >
                    <FolderOpen className="h-4 w-4" />
                    选择
                  </Button>
                </div>
              </Field>
              <Field label="复制目标文件夹">
                <div className="flex gap-2">
                  <Input
                    value={config.copy_target_dir}
                    onChange={(ev) =>
                      void onUpdatePublishAppResource(project.id, {
                        copy_target_dir: ev.target.value,
                      })
                    }
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() => void pickCopyDir("copy_target_dir", "选择复制目标文件夹")}
                  >
                    <FolderOpen className="h-4 w-4" />
                    选择
                  </Button>
                </div>
              </Field>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="最终命令">
        <div className="rounded-lg border border-border bg-bg p-3 font-mono text-xs leading-6 text-fg">
          {command}
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void onCopy(project)}>
            <Clipboard className="h-3.5 w-3.5" />
            复制命令
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canPublish}
            onClick={() => void onPublish(project)}
          >
            {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
            生成本地打包资源
          </Button>
        </div>
        {config.copy_enabled && !copyReady && (
          <div className="mt-2 text-xs text-danger">复制开启时需要填写源文件夹和目标文件夹。</div>
        )}
      </Panel>

      {hasOutput && (
        <Panel title="发行结果">
          <div className="mb-3 flex items-center gap-2 text-sm">
            {publishing ? (
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
            ) : result?.success ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <XCircle className="h-4 w-4 text-danger" />
            )}
            <span>
              {publishing
                ? "发行中"
                : result?.success
                  ? "执行成功"
                  : result?.command_success
                    ? "发行成功，复制失败"
                    : "执行失败"}
            </span>
            <span className="text-xs text-fg-muted">退出码: {result?.exit_code ?? "无"}</span>
          </div>
          {result?.error && <pre className="mb-2 whitespace-pre-wrap rounded bg-danger/10 p-2 text-xs text-danger">{result.error}</pre>}
          {(stdout || stderr) && (
            <Suspense fallback={<TerminalLogFallback />}>
              <TerminalLog stdout={stdout} stderr={stderr} />
            </Suspense>
          )}
          {result?.copy_result && (
            <div className="mt-3 rounded-lg border border-border bg-bg p-3 text-sm">
              <div className="flex items-center gap-2">
                {result.copy_result.success ? (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                ) : (
                  <XCircle className="h-4 w-4 text-danger" />
                )}
                <span>{result.copy_result.success ? "复制成功" : "复制失败"}</span>
                <span className="text-xs text-fg-muted">
                  已复制 {result.copy_result.copied}，失败 {result.copy_result.failed}
                </span>
              </div>
              <div className="mt-2 grid gap-1 font-mono text-xs text-fg-muted">
                <div>源: {result.copy_result.source_dir}</div>
                <div>目标: {result.copy_result.target_dir}</div>
              </div>
              {result.copy_result.error && (
                <pre className="mt-2 whitespace-pre-wrap rounded bg-danger/10 p-2 text-xs text-danger">
                  {result.copy_result.error}
                </pre>
              )}
              {result.copy_result.failures.length > 0 && (
                <div className="mt-2 max-h-36 overflow-auto rounded border border-border bg-bg-subtle p-2 text-xs">
                  {result.copy_result.failures.slice(0, 20).map((failure, index) => (
                    <div key={`${failure.source}-${index}`} className="mb-2 last:mb-0">
                      <div className="font-mono text-fg-muted">{failure.source}</div>
                      <div className="text-danger">{failure.error}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {publishing && !stdout && !stderr && (
            <div className="rounded border border-dashed border-border px-3 py-6 text-center text-xs text-fg-muted">
              正在等待 CLI 输出...
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

function ProjectPublishMpAlipayCard({
  project,
  cliDir,
  publishing,
  result,
  onUpdateProject,
  onUpdatePublishMpAlipay,
  onRemove,
  onRebind,
  onCopy,
  onPublish,
  onExport,
  onError,
}: {
  project: HBuilderXProject;
  cliDir: string;
  publishing: boolean;
  result?: HBuilderXPublishResult;
  onUpdateProject: (id: string, patch: Partial<HBuilderXProject>) => Promise<void>;
  onUpdatePublishMpAlipay: (
    id: string,
    patch: Partial<HBuilderXPublishMpAlipayConfig>,
  ) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onRebind: (project: HBuilderXProject) => Promise<void>;
  onCopy: (project: HBuilderXProject) => Promise<void>;
  onPublish: (project: HBuilderXProject) => Promise<void>;
  onExport: (projectId: string) => Promise<void>;
  onError?: (message: string) => void;
}) {
  const config = {
    ...defaultPublishMpAlipayConfig(),
    ...project.publish.mp_alipay,
  };
  const command = buildPublishMpAlipayDisplayCommand(cliDir, project.path, config);
  const uploadReady =
    !config.upload || Boolean(config.appid.trim() && config.privatekey.trim());
  const canPublish =
    Boolean(cliDir.trim() && project.path.trim() && uploadReady) && !publishing;
  const stdout = result?.stdout ?? "";
  const stderr = result?.stderr ?? "";
  const hasOutput = publishing || Boolean(result || stdout || stderr);

  async function pickPrivatekey() {
    const picked = await openDialog({
      multiple: false,
      title: "选择支付宝开发工具密钥文件",
    });
    if (!picked || typeof picked !== "string") return;
    await onUpdatePublishMpAlipay(project.id, { privatekey: picked });
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel title="项目">
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <Field label="名称">
            <Input
              value={project.name}
              onChange={(ev) => void onUpdateProject(project.id, { name: ev.target.value })}
            />
          </Field>
          <Field label="项目路径">
            <div className="flex gap-2">
              <Input
                value={project.path}
                onChange={(ev) => void onUpdateProject(project.id, { path: ev.target.value })}
                className="font-mono text-xs"
              />
              <Button variant="outline" size="md" onClick={() => void onRebind(project)}>
                <FolderOpen className="h-4 w-4" />
                选择
              </Button>
            </div>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <OpenWithButton path={project.path} label="打开文件夹" onError={onError} />
          <Button variant="outline" size="sm" onClick={() => void onExport(project.id)}>
            <Upload className="h-3.5 w-3.5" />
            导出此项目
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void onRemove(project.id)}>
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </Button>
        </div>
      </Panel>

      <Panel title="支付宝小程序参数">
        <p className="mb-3 text-xs text-fg-muted">
          仅支持 uni-app 项目的 mp-alipay 平台（HBuilderX 3.8.5+）。不开启上传时只编译。
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="小程序 appid">
            <Input
              value={config.appid}
              placeholder="支付宝小程序 appid"
              onChange={(ev) =>
                void onUpdatePublishMpAlipay(project.id, { appid: ev.target.value })
              }
              className="font-mono text-xs"
            />
          </Field>
          <Field label="版本号（留空读取 manifest.json）">
            <Input
              value={config.version}
              placeholder="1.0.0"
              onChange={(ev) =>
                void onUpdatePublishMpAlipay(project.id, { version: ev.target.value })
              }
              className="font-mono text-xs"
            />
          </Field>
          <Field label="发布描述">
            <Input
              value={config.description}
              placeholder="上传的小程序描述"
              onChange={(ev) =>
                void onUpdatePublishMpAlipay(project.id, { description: ev.target.value })
              }
            />
          </Field>
          <Field label="混合包名（留空则不发混合包）">
            <Input
              value={config.sub_package}
              placeholder="--subPackage"
              onChange={(ev) =>
                void onUpdatePublishMpAlipay(project.id, { sub_package: ev.target.value })
              }
              className="font-mono text-xs"
            />
          </Field>
        </div>
        <div className="mt-3 grid gap-3">
          <ToggleField
            label="打包后上传到支付宝平台"
            checked={config.upload}
            onChange={(checked) =>
              void onUpdatePublishMpAlipay(project.id, { upload: checked })
            }
          />
          {config.upload && (
            <Field label="支付宝开发工具密钥文件">
              <div className="flex gap-2">
                <Input
                  value={config.privatekey}
                  onChange={(ev) =>
                    void onUpdatePublishMpAlipay(project.id, { privatekey: ev.target.value })
                  }
                  className="font-mono text-xs"
                />
                <Button variant="outline" size="md" onClick={() => void pickPrivatekey()}>
                  <FolderOpen className="h-4 w-4" />
                  选择
                </Button>
              </div>
            </Field>
          )}
        </div>
        {config.upload && (
          <p className="mt-3 text-xs text-fg-muted">
            密钥文件在支付宝开放平台「开发工具密钥」中生成并下载，上传时 appid 与密钥均为必填。
          </p>
        )}
      </Panel>

      <Panel title="最终命令">
        <div className="rounded-lg border border-border bg-bg p-3 font-mono text-xs leading-6 text-fg">
          {command}
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void onCopy(project)}>
            <Clipboard className="h-3.5 w-3.5" />
            复制命令
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canPublish}
            onClick={() => void onPublish(project)}
          >
            {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
            {publishing ? "正在发行..." : config.upload ? "编译并上传" : "仅编译"}
          </Button>
        </div>
        {!uploadReady && (
          <div className="mt-2 text-xs text-danger">
            上传开启时需要填写小程序 appid 和开发工具密钥文件。
          </div>
        )}
      </Panel>

      {hasOutput && (
        <Panel title="发行结果">
          <div className="mb-3 flex items-center gap-2 text-sm">
            {publishing ? (
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
            ) : result?.success ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <XCircle className="h-4 w-4 text-danger" />
            )}
            <span>
              {publishing ? "发行中" : result?.success ? "执行成功" : "执行失败"}
            </span>
            <span className="text-xs text-fg-muted">退出码: {result?.exit_code ?? "无"}</span>
          </div>
          {result?.error && (
            <pre className="mb-2 whitespace-pre-wrap rounded bg-danger/10 p-2 text-xs text-danger">
              {result.error}
            </pre>
          )}
          {(stdout || stderr) && (
            <Suspense fallback={<TerminalLogFallback />}>
              <TerminalLog stdout={stdout} stderr={stderr} />
            </Suspense>
          )}
          {publishing && !stdout && !stderr && (
            <div className="rounded border border-dashed border-border px-3 py-6 text-center text-xs text-fg-muted">
              正在编译{config.upload ? "并上传" : ""}，完成后显示 CLI 输出，可继续操作窗口。
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

function Segment({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-medium",
        active ? "border-accent bg-accent text-accent-fg" : "border-border bg-bg text-fg-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function PlatformButton({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border p-3 text-left text-sm transition",
        active ? "border-accent bg-accent/10 text-fg" : "border-border bg-bg text-fg hover:border-border-strong",
        disabled && "opacity-50",
      )}
    >
      <div className="font-medium">{label}</div>
      {disabled && <div className="mt-1 text-xs text-fg-muted">暂未实现</div>}
    </button>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-bg-subtle p-4">
      <h2 className="mb-3 text-sm font-semibold text-fg">{title}</h2>
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

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(Boolean(value))} />
      {label}
    </label>
  );
}

function EmptyState({ text, onAdd }: { text: string; onAdd?: () => void }) {
  return (
    <BaseEmptyState
      icon={<Terminal className="h-6 w-6" />}
      title="暂无项目"
      description={text}
      action={
        onAdd && (
          <Button variant="primary" size="sm" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" />
            添加项目
          </Button>
        )
      }
      className="my-8"
    />
  );
}

function buildProjectSections(
  projects: HBuilderXProject[],
  groups: HBuilderXProjectGroup[],
): ProjectSection[] {
  const knownProjectIds = new Set(projects.map((project) => project.id));
  const assignedProjectIds = new Set<string>();
  const sections: ProjectSection[] = [];

  for (const group of groups) {
    const projectIds = group.project_ids.filter((id) => {
      if (!knownProjectIds.has(id) || assignedProjectIds.has(id)) return false;
      assignedProjectIds.add(id);
      return true;
    });
    sections.push({
      id: group.id || `hbx-group-${sections.length + 1}`,
      name: group.name.trim() || "分组",
      projectIds,
      builtin: false,
      collapsed: Boolean(group.collapsed),
    });
  }

  const ungroupedProjectIds = projects
    .map((project) => project.id)
    .filter((id) => !assignedProjectIds.has(id));

  return [
    {
      id: UNGROUPED_SECTION_ID,
      name: "未分组",
      projectIds: ungroupedProjectIds,
      builtin: true,
      collapsed: false,
    },
    ...sections,
  ];
}

function findSectionIdByProject(sections: ProjectSection[], projectId: string) {
  return sections.find((section) => section.projectIds.includes(projectId))?.id ?? null;
}

function isSectionId(sections: ProjectSection[], id: string) {
  return sections.some((section) => section.id === id);
}

function defaultRunWebConfig(): HBuilderXRunWebConfig {
  return {
    browser: "Built",
    ui: false,
    compile: false,
    continue_on_error: false,
  };
}

function defaultPublishAppResourceConfig(): HBuilderXPublishAppResourceConfig {
  return {
    platform: "APP",
    copy_enabled: false,
    copy_source_dir: "",
    copy_target_dir: "",
  };
}

function defaultPublishMpAlipayConfig(): HBuilderXPublishMpAlipayConfig {
  return {
    appid: "",
    upload: false,
    description: "",
    version: "",
    privatekey: "",
    sub_package: "",
  };
}

function buildPublishMpAlipayDisplayCommand(
  cliDir: string,
  projectPath: string,
  options: HBuilderXPublishMpAlipayConfig,
) {
  const cli = cliDir.trim() ? `${cliDir.replace(/[\\/]$/, "")}\\cli.exe` : "cli.exe";
  const parts = [cli, "publish", "--platform", "mp-alipay", "--project", projectPath || "<项目全路径>"];
  if (options.sub_package.trim()) parts.push("--subPackage", options.sub_package.trim());
  if (options.upload) {
    parts.push("--upload", "true", "--appid", options.appid.trim() || "<appid>");
    if (options.description.trim()) parts.push("--description", options.description.trim());
    if (options.version.trim()) parts.push("--version", options.version.trim());
    parts.push("--privatekey", options.privatekey.trim() || "<密钥文件全路径>");
  }
  return parts.map(quotePart).join(" ");
}

function buildDisplayCommand(cliDir: string, projectPath: string, options: HBuilderXRunWebConfig) {
  const cli = cliDir.trim() ? `${cliDir.replace(/[\\/]$/, "")}\\cli.exe` : "cli.exe";
  const parts = [cli, "launch", "web", "--project", projectPath || "<项目全路径>"];
  if (options.browser) parts.push("--browser", options.browser);
  if (options.ui) parts.push("--ui", "true");
  if (options.compile) parts.push("--compile", "true");
  if (options.continue_on_error) parts.push("--continue-on-error", "true");
  return parts.map(quotePart).join(" ");
}

function buildPublishAppResourceDisplayCommand(
  cliDir: string,
  projectPath: string,
  options: HBuilderXPublishAppResourceConfig,
) {
  const cli = cliDir.trim() ? `${cliDir.replace(/[\\/]$/, "")}\\cli.exe` : "cli.exe";
  const platform = options.platform || "APP";
  const parts = [cli, "publish"];
  if (platform === "APP") {
    parts.push("--platform", "APP");
  } else {
    parts.push(platform);
  }
  parts.push("--type", "appResource", "--project", projectPath || "<项目全路径>");
  return parts.map(quotePart).join(" ");
}

function quotePart(value: string) {
  if (!value) return "\"\"";
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function baseName(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
}

function samePath(a: string, b: string) {
  return normalizePathKey(a) === normalizePathKey(b);
}

function normalizePathKey(path: string) {
  return path.trim().replace(/\//g, "\\").toLowerCase();
}
