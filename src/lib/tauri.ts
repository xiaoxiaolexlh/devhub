import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface Editor {
  id: string;
  name: string;
  path: string;
  built_in: boolean;
  process_names: string[];
}

export type OpenMethodKind = "explorer" | "workspace" | "external_app";

export interface OpenMethod {
  id: string;
  name: string;
  kind: OpenMethodKind;
  built_in: boolean;
  enabled: boolean;
  /** Executable path or PATH command. Only used by external_app. */
  command: string;
  /** Args template; `{path}` is replaced. Default `"{path}"`. */
  args_template: string;
}

export interface Extension {
  id: string;
  publisher: string;
  name: string;
  display_name: string | null;
  version: string;
  description: string | null;
  icon_path: string | null;
  folder_name: string;
  folder_path: string;
  size_bytes: number;
  engines_vscode: string | null;
  is_ms_proprietary: boolean;
  /** Folder is listed in this editor's extensions.json (i.e. actually loaded).
   *  False means the folder exists on disk but is an orphan and is ignored. */
  registered: boolean;
}

export interface EditorScan {
  editor: Editor;
  exists: boolean;
  extensions: Extension[];
  error: string | null;
}

export interface CopyTask {
  source_path: string;
  target_dir: string;
  folder_name: string;
}

export interface CopyResultItem {
  source_path: string;
  target_path: string;
  success: boolean;
  skipped: boolean;
  overwritten: boolean;
  error: string | null;
}

export interface ProjectConfigEntry {
  name: string;
  path: string;
  exists: boolean;
}

export interface ProjectConfigTask {
  source_project_dir: string;
  target_project_dir: string;
  config_dir_name: string;
}

export interface ProjectConfigResultItem {
  config_dir_name: string;
  source_path: string;
  target_path: string;
  success: boolean;
  skipped: boolean;
  overwritten: boolean;
  error: string | null;
}

export interface DeleteTask {
  path: string;
}

export interface DeleteResultItem {
  path: string;
  success: boolean;
  trash_path: string | null;
  error: string | null;
}

export interface WorkspaceEntry {
  name: string;
  path: string;
  relative_path: string;
  is_dir: boolean;
  size_bytes: number;
}

export interface WorkspaceFile {
  path: string;
  relative_path: string;
  content: string;
}

export type ConflictStrategy = "skip" | "ask" | "overwrite";
export type Theme = "light" | "dark" | "system";
export type HBuilderXBrowser =
  | "Built"
  | "Chrome"
  | "Firefox"
  | "Ie"
  | "Edge"
  | "Safari";

export interface HBuilderXRunWebConfig {
  browser: HBuilderXBrowser;
  ui: boolean;
  compile: boolean;
  continue_on_error: boolean;
}

export interface HBuilderXRunConfig {
  web: HBuilderXRunWebConfig;
}

export type HBuilderXAppResourcePlatform = "APP" | "app-ios" | "app-android";

export interface HBuilderXPublishAppResourceConfig {
  platform: HBuilderXAppResourcePlatform;
  copy_enabled: boolean;
  copy_source_dir: string;
  copy_target_dir: string;
}

export interface HBuilderXPublishConfig {
  web: Record<string, unknown>;
  app_resource: HBuilderXPublishAppResourceConfig;
}

export interface HBuilderXProject {
  id: string;
  name: string;
  path: string;
  run: HBuilderXRunConfig;
  publish: HBuilderXPublishConfig;
}

export interface HBuilderXProjectGroup {
  id: string;
  name: string;
  project_ids: string[];
  collapsed: boolean;
}

export interface HBuilderXCliStatus {
  cli_path: string | null;
  exists: boolean;
  error: string | null;
}

export interface HBuilderXRunWebRequest {
  cli_dir: string;
  project_path: string;
  options: HBuilderXRunWebConfig;
}

export interface HBuilderXPublishAppResourceRequest {
  cli_dir: string;
  project_path: string;
  options: HBuilderXPublishAppResourceConfig;
}

export interface HBuilderXCommandPreview {
  cli_path: string;
  args: string[];
  command: string;
}

export interface HBuilderXRunResult {
  success: boolean;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  command: string;
  error: string | null;
}

export interface HBuilderXRunState {
  project_path: string;
  running: boolean;
  pid: number | null;
  command: string;
  stdout: string;
  stderr: string;
  success: boolean | null;
  exit_code: number | null;
  error: string | null;
}

export interface FolderCopyFailure {
  source: string;
  target: string;
  error: string;
}

export interface FolderCopyResult {
  success: boolean;
  source_dir: string;
  target_dir: string;
  copied: number;
  failed: number;
  failures: FolderCopyFailure[];
  error: string | null;
}

export interface HBuilderXPublishResult {
  success: boolean;
  command_success: boolean;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  command: string;
  error: string | null;
  copy_result: FolderCopyResult | null;
}

export interface HBuilderXStopWebRequest {
  project_path: string;
}

export interface HBuilderXStopResult {
  success: boolean;
  pid: number | null;
  error: string | null;
}

export interface HBuilderXStopAllResult {
  project_path: string;
  success: boolean;
  pid: number | null;
  error: string | null;
}

export interface AiConfigTool {
  id: string;
  name: string;
  config_dir: string;
}

export interface AiConfigToolStatus {
  id: string;
  exists: boolean;
  is_dir: boolean;
}

export interface AiConfigToolFile {
  name: string;
  path: string;
  exists: boolean;
  is_dir: boolean;
  description: string;
  known: boolean;
}

export interface AiConfigToolFiles {
  id: string;
  files: AiConfigToolFile[];
}

export interface NodeEnvStatus {
  available: boolean;
  version: string | null;
  error: string | null;
}

export interface AiAgentStatus {
  id: string;
  name: string;
  description: string;
  npm_package: string;
  command: string;
  homepage: string;
  /** Distribution channel: npm global package or vendor install script. */
  source: "npm" | "script";
  /** False only when the npm global-list probe failed (npm missing/broken). */
  detect_ok: boolean;
  /** Whether a latest-version source exists for the update badge. */
  has_update_check: boolean;
  installed: boolean;
  installed_version: string | null;
  /** Full install command shown in the UI and used for install (also updates). */
  install_command: string;
  /** Full uninstall command shown in the UI and used for uninstall. */
  uninstall_command: string;
}

export interface AiAgentLatestVersion {
  id: string;
  version: string | null;
  error: string | null;
}

export interface AiAgentRunResult {
  task_id: string;
  agent_id: string;
  command: string;
  error: string | null;
}

export interface AiAgentTaskState {
  task_id: string;
  agent_id: string;
  /** "install" for npm install, "uninstall" for npm uninstall. */
  kind: "install" | "uninstall" | string;
  command: string;
  running: boolean;
  pid: number | null;
  started_at: string;
  finished_at: string | null;
  stdout: string;
  stderr: string;
  success: boolean | null;
  exit_code: number | null;
  error: string | null;
}

export interface AiAgentStopResult {
  task_id: string;
  success: boolean;
  error: string | null;
}

export interface AiAgentLogEvent {
  task_id: string;
  agent_id: string;
  stream: "stdout" | "stderr" | string;
  line: string;
}

export interface AiAgentExitEvent {
  task_id: string;
  agent_id: string;
  success: boolean;
  exit_code: number | null;
  error: string | null;
}

export interface NodeService {
  id: string;
  name: string;
  path: string;
  /** Quick commands the user saved for this service, e.g. `npm run dev`. */
  commands: string[];
}

export interface NodeServiceScript {
  name: string;
  command: string;
}

export interface NodeServiceInfo {
  package_manager: string;
  has_package_json: boolean;
  has_node_modules: boolean;
  scripts: NodeServiceScript[];
}

export interface NodeServiceRunRequest {
  service_id: string;
  service_path: string;
  command: string;
}

export interface NodeServiceRunResult {
  task_id: string;
  command: string;
  error: string | null;
}

export interface NodeServiceTaskState {
  task_id: string;
  service_id: string;
  service_path: string;
  /** "command" for user-entered commands, "http" for the built-in static server. */
  kind: string;
  command: string;
  running: boolean;
  pid: number | null;
  started_at: string;
  finished_at: string | null;
  stdout: string;
  stderr: string;
  success: boolean | null;
  exit_code: number | null;
  error: string | null;
}

export interface NodeServiceStopResult {
  task_id: string;
  success: boolean;
  error: string | null;
}

export interface NodeServiceLogEvent {
  task_id: string;
  service_id: string;
  stream: "stdout" | "stderr" | string;
  line: string;
}

export interface NodeServiceExitEvent {
  task_id: string;
  service_id: string;
  success: boolean;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
}

export interface TerminalProject {
  id: string;
  name: string;
  path: string;
  tool_ids: string[];
}

export interface TerminalAiTool {
  id: string;
  name: string;
  command: string;
}

export interface TerminalEnvVar {
  key: string;
  value: string;
}

export interface TerminalEnvGroup {
  id: string;
  name: string;
  variables: TerminalEnvVar[];
}

export interface TerminalSession {
  id: string;
  project_id: string;
  project_name: string;
  project_path: string;
  tool_id: string;
  tool_name: string;
  tool_sequence: number;
  started_at: string;
  window_title: string;
}

export interface TerminalLaunchResult {
  session: TerminalSession;
  created: boolean;
}

export interface TerminalActionResult {
  success: boolean;
  affected: number;
  error: string | null;
}

export interface HBuilderXRunLogEvent {
  project_path: string;
  stream: "stdout" | "stderr" | string;
  line: string;
}

export interface HBuilderXRunExitEvent {
  project_path: string;
  success: boolean;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  command: string;
  error: string | null;
}

export interface CustomTool {
  id: string;
  name: string;
  exe_path: string;
}

export interface Settings {
  settings_version: number;
  editors: Editor[];
  source_editor: string;
  conflict_strategy: ConflictStrategy;
  backup_days: number;
  theme: Theme;
  project_config_dirs: string[];
  project_roots: string[];
  hbuilderx_cli_dir: string;
  hbuilderx_projects: HBuilderXProject[];
  hbuilderx_project_groups: HBuilderXProjectGroup[];
  ai_config_tools: AiConfigTool[];
  node_services: NodeService[];
  terminal_projects: TerminalProject[];
  terminal_ai_tools: TerminalAiTool[];
  terminal_env_enabled: boolean;
  terminal_env_groups: TerminalEnvGroup[];
  terminal_env_active_group_ids: string[];
  open_methods: OpenMethod[];
  default_open_method_id: string;
  custom_tools: CustomTool[];
}

export type CleanerAction = "clear" | "remove";

export interface CleanerDirectoryEntry {
  path: string;
  label: string;
}

export interface CleanerProfile {
  description: string;
  allowedActions: CleanerAction[];
  defaultAction: CleanerAction;
  directories: CleanerDirectoryEntry[];
}

export interface CleanerConfig {
  profiles: Record<string, CleanerProfile>;
}

export interface CleanerConfigPayload {
  configPath: string;
  config: CleanerConfig;
}

export interface CleanerPathPreview {
  label: string;
  path: string;
  absolutePath: string;
  exists: boolean;
  isDir: boolean;
  isFile: boolean;
  status: "ready" | "missing" | "skipped" | "success" | "error" | string;
  message: string;
}

export interface CleanerCleanResult {
  label: string;
  path: string;
  absolutePath: string;
  action: CleanerAction;
  status: "ready" | "missing" | "skipped" | "success" | "error" | string;
  message: string;
}

export interface ToolListItem {
  id: string;
  name: string;
  group: string;
  groupName: string;
  description: string;
  homepage: string;
  installed: boolean;
  version: string;
  exePath: string;
  installedAt: string;
  lastChecked: string;
  hasUpdate: boolean;
  latestVersion: string;
  changelog: string[];
}

export interface ToolUpdateInfo {
  hasUpdate: boolean;
  latestVersion: string;
  changelog: string[];
}

export interface ToolDownloadProgress {
  toolId: string;
  downloaded: number;
  total: number;
  percent: number;
}

export interface KnownFolder {
  id: string;
  label: string;
  description: string;
  current_path: string | null;
  default_path: string | null;
  is_default: boolean;
}

export interface SetKnownFolderResult {
  id: string;
  new_path: string;
  moved_files: number;
  skipped_files: number;
}

export const tauri = {
  listEditors: () => invoke<Editor[]>("list_editors"),
  scanExtensions: (editor_id: string) =>
    invoke<EditorScan>("scan_extensions", { editorId: editor_id }),
  scanAll: () => invoke<EditorScan[]>("scan_all"),
  copyExtensions: (tasks: CopyTask[], conflict_strategy: ConflictStrategy) =>
    invoke<CopyResultItem[]>("copy_extensions", {
      tasks,
      conflictStrategy: conflict_strategy,
    }),
  scanProjectConfigDirs: (project_dir: string, config_dirs: string[]) =>
    invoke<ProjectConfigEntry[]>("scan_project_config_dirs", {
      projectDir: project_dir,
      configDirs: config_dirs,
    }),
  syncProjectConfigs: (
    tasks: ProjectConfigTask[],
    conflict_strategy: ConflictStrategy,
  ) =>
    invoke<ProjectConfigResultItem[]>("sync_project_configs", {
      tasks,
      conflictStrategy: conflict_strategy,
    }),
  resolveHBuilderXCli: (cli_dir: string) =>
    invoke<HBuilderXCliStatus>("resolve_hbuilderx_cli", { cliDir: cli_dir }),
  previewHBuilderXRunWeb: (request: HBuilderXRunWebRequest) =>
    invoke<HBuilderXCommandPreview>("preview_hbuilderx_run_web", { request }),
  runHBuilderXWeb: (request: HBuilderXRunWebRequest) =>
    invoke<HBuilderXRunResult>("run_hbuilderx_web", { request }),
  getHBuilderXWebRuns: () =>
    invoke<HBuilderXRunState[]>("get_hbuilderx_web_runs"),
  stopAllHBuilderXWebRuns: () =>
    invoke<HBuilderXStopAllResult[]>("stop_all_hbuilderx_web_runs"),
  previewHBuilderXPublishAppResource: (
    request: HBuilderXPublishAppResourceRequest,
  ) =>
    invoke<HBuilderXCommandPreview>("preview_hbuilderx_publish_app_resource", {
      request,
    }),
  runHBuilderXPublishAppResource: (
    request: HBuilderXPublishAppResourceRequest,
  ) =>
    invoke<HBuilderXPublishResult>("run_hbuilderx_publish_app_resource", {
      request,
    }),
  stopHBuilderXWeb: (request: HBuilderXStopWebRequest) =>
    invoke<HBuilderXStopResult>("stop_hbuilderx_web", { request }),
  onHBuilderXRunLog: (handler: (event: HBuilderXRunLogEvent) => void) =>
    listen<HBuilderXRunLogEvent>("hbuilderx-run-log", (event) =>
      handler(event.payload),
    ),
  onHBuilderXRunExit: (handler: (event: HBuilderXRunExitEvent) => void) =>
    listen<HBuilderXRunExitEvent>("hbuilderx-run-exit", (event) =>
      handler(event.payload),
    ),
  exportHBuilderXCliConfig: (
    path: string,
    project_ids: string[] | null = null,
  ) =>
    invoke<void>("export_hbuilderx_cli_config", {
      path,
      projectIds: project_ids,
    }),
  importHBuilderXCliConfig: (path: string) =>
    invoke<Settings>("import_hbuilderx_cli_config", { path }),
  getAiConfigToolStatuses: () =>
    invoke<AiConfigToolStatus[]>("get_ai_config_tool_statuses"),
  getAiConfigToolFiles: () =>
    invoke<AiConfigToolFiles[]>("get_ai_config_tool_files"),
  aiAgentCheckNode: () => invoke<NodeEnvStatus>("ai_agent_check_node"),
  aiAgentList: () => invoke<AiAgentStatus[]>("ai_agent_list"),
  aiAgentLatestVersions: () =>
    invoke<AiAgentLatestVersion[]>("ai_agent_latest_versions"),
  aiAgentInstall: (agentId: string, version?: string | null) =>
    invoke<AiAgentRunResult>("ai_agent_install", { agentId, version: version ?? null }),
  aiAgentUninstall: (agentId: string) =>
    invoke<AiAgentRunResult>("ai_agent_uninstall", { agentId }),
  aiAgentTaskList: () => invoke<AiAgentTaskState[]>("ai_agent_task_list"),
  aiAgentTaskStop: (taskId: string) =>
    invoke<AiAgentStopResult>("ai_agent_task_stop", { taskId }),
  aiAgentTaskClear: (taskId: string) =>
    invoke<void>("ai_agent_task_clear", { taskId }),
  onAiAgentLog: (handler: (event: AiAgentLogEvent) => void) =>
    listen<AiAgentLogEvent>("ai-agent-log", (event) =>
      handler(event.payload),
    ),
  onAiAgentExit: (handler: (event: AiAgentExitEvent) => void) =>
    listen<AiAgentExitEvent>("ai-agent-exit", (event) =>
      handler(event.payload),
    ),
  nodeServiceReadInfo: (path: string) =>
    invoke<NodeServiceInfo>("node_service_read_info", { path }),
  nodeServiceRun: (request: NodeServiceRunRequest) =>
    invoke<NodeServiceRunResult>("node_service_run", { request }),
  nodeServiceStartHttp: (service_id: string, service_path: string, allow_lan = false) =>
    invoke<NodeServiceRunResult>("node_service_start_http", {
      serviceId: service_id,
      servicePath: service_path,
      allowLan: allow_lan,
    }),
  nodeServiceListTasks: () =>
    invoke<NodeServiceTaskState[]>("node_service_list_tasks"),
  nodeServiceStopTask: (task_id: string) =>
    invoke<NodeServiceStopResult>("node_service_stop_task", { taskId: task_id }),
  nodeServiceStopService: (service_id: string) =>
    invoke<NodeServiceStopResult[]>("node_service_stop_service", {
      serviceId: service_id,
    }),
  nodeServiceClearTask: (task_id: string) =>
    invoke<void>("node_service_clear_task", { taskId: task_id }),
  onNodeServiceLog: (handler: (event: NodeServiceLogEvent) => void) =>
    listen<NodeServiceLogEvent>("node-services-log", (event) =>
      handler(event.payload),
    ),
  onNodeServiceExit: (handler: (event: NodeServiceExitEvent) => void) =>
    listen<NodeServiceExitEvent>("node-services-exit", (event) =>
      handler(event.payload),
    ),
  exportAiConfigTools: (path: string) =>
    invoke<void>("export_ai_config_tools", { path }),
  importAiConfigTools: (path: string) =>
    invoke<Settings>("import_ai_config_tools", { path }),
  deleteExtensions: (tasks: DeleteTask[]) =>
    invoke<DeleteResultItem[]>("delete_extensions", { tasks }),
  openInExplorer: (path: string) => invoke<void>("open_in_explorer", { path }),
  openFolderWindow: (path: string) =>
    invoke<void>("open_folder_window", { path }),
  openWithMethod: (method_id: string, path: string) =>
    invoke<void>("open_with_method", { methodId: method_id, path }),
  readWorkspaceDir: (root: string, relative_path: string) =>
    invoke<WorkspaceEntry[]>("read_workspace_dir", {
      root,
      relativePath: relative_path,
    }),
  readWorkspaceFile: (root: string, relative_path: string) =>
    invoke<WorkspaceFile>("read_workspace_file", {
      root,
      relativePath: relative_path,
    }),
  writeWorkspaceFile: (
    root: string,
    relative_path: string,
    content: string,
  ) =>
    invoke<void>("write_workspace_file", {
      root,
      relativePath: relative_path,
      content,
    }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) =>
    invoke<void>("save_settings", { settings }),
  listTerminalSessions: () =>
    invoke<TerminalSession[]>("list_terminal_sessions"),
  filterTerminalProjectDirectories: (paths: string[]) =>
    invoke<string[]>("filter_terminal_project_directories", { paths }),
  launchTerminalSession: (
    project_id: string,
    tool_id: string,
    force_new: boolean,
  ) =>
    invoke<TerminalLaunchResult>("launch_terminal_session", {
      projectId: project_id,
      toolId: tool_id,
      forceNew: force_new,
    }),
  focusTerminalSession: (session_id: string) =>
    invoke<TerminalActionResult>("focus_terminal_session", {
      sessionId: session_id,
    }),
  closeTerminalSession: (session_id: string) =>
    invoke<TerminalActionResult>("close_terminal_session", {
      sessionId: session_id,
    }),
  closeTerminalProjectSessions: (project_id: string) =>
    invoke<TerminalActionResult>("close_terminal_project_sessions", {
      projectId: project_id,
    }),
  closeTerminalToolSessions: (tool_id: string) =>
    invoke<TerminalActionResult>("close_terminal_tool_sessions", {
      toolId: tool_id,
    }),
  checkRunningProcesses: (editor_ids: string[]) =>
    invoke<string[]>("check_running_processes", { editorIds: editor_ids }),
  purgeTrash: () => invoke<void>("purge_trash"),
  cleanerLoadConfig: () => invoke<CleanerConfigPayload>("cleaner_load_config"),
  cleanerSaveConfig: (config: CleanerConfig) =>
    invoke<CleanerConfigPayload>("cleaner_save_config", { config }),
  cleanerImportConfig: (source_path: string) =>
    invoke<CleanerConfigPayload>("cleaner_import_config", {
      sourcePath: source_path,
    }),
  cleanerExportConfig: (destination_path: string) =>
    invoke<void>("cleaner_export_config", { destinationPath: destination_path }),
  cleanerPathStatus: (path: string) =>
    invoke<CleanerPathPreview>("cleaner_path_status", { path }),
  cleanerPreviewProfile: (profile_key: string, action: CleanerAction) =>
    invoke<CleanerPathPreview[]>("cleaner_preview_profile", {
      profileKey: profile_key,
      action,
    }),
  cleanerExecuteProfile: (profile_key: string, action: CleanerAction) =>
    invoke<CleanerCleanResult[]>("cleaner_execute_profile", {
      profileKey: profile_key,
      action,
    }),
  toolList: () => invoke<ToolListItem[]>("tool_list"),
  toolDownload: (toolId: string) =>
    invoke<ToolListItem>("tool_download", { toolId }),
  toolCheckUpdates: (toolId: string) =>
    invoke<ToolUpdateInfo>("tool_check_updates", { toolId }),
  toolUpdate: (toolId: string) =>
    invoke<ToolListItem>("tool_update", { toolId }),
  toolLaunch: (toolId: string) => invoke<void>("tool_launch", { toolId }),
  toolOpenDir: (toolId: string) => invoke<void>("tool_open_dir", { toolId }),
  toolIsElevated: () => invoke<boolean>("tool_is_elevated"),
  toolRestartElevated: () => invoke<boolean>("tool_restart_elevated"),
  /** Returns "launched" | "focused" | "running". */
  customToolOpen: (exePath: string) =>
    invoke<"launched" | "focused" | "running">("custom_tool_open", {
      exePath,
    }),
  customToolOpenDir: (exePath: string) =>
    invoke<void>("custom_tool_open_dir", { exePath }),
  systemTurnOffDisplay: () => invoke<void>("system_turn_off_display"),
  systemListKnownFolders: () =>
    invoke<KnownFolder[]>("system_list_known_folders"),
  systemSetKnownFolder: (id: string, newPath: string, moveFiles: boolean) =>
    invoke<SetKnownFolderResult>("system_set_known_folder", {
      id,
      newPath,
      moveFiles,
    }),
  systemRestoreKnownFolder: (id: string, moveFiles: boolean) =>
    invoke<SetKnownFolderResult>("system_restore_known_folder", {
      id,
      moveFiles,
    }),
  onToolDownloadProgress: (handler: (event: ToolDownloadProgress) => void) =>
    listen<ToolDownloadProgress>("tool-download-progress", (event) =>
      handler(event.payload),
    ),
};

export function iconUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  try {
    return convertFileSrc(path);
  } catch {
    return undefined;
  }
}
