use crate::editors::Editor;
use crate::scanner::{self, Extension};
use crate::settings::{
    self, AiConfigTool, HBuilderXProject, HBuilderXProjectGroup, HBuilderXPublishAppResourceConfig,
    HBuilderXRunWebConfig, OpenMethod, OpenMethodKind, Settings,
};
use crate::syncer::{
    self, CopyResultItem, CopyTask, ProjectConfigEntry, ProjectConfigResultItem, ProjectConfigTask,
};
use crate::terminal::{self, TerminalActionResult, TerminalLaunchResult, TerminalSession};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::collections::HashSet;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};
use walkdir::WalkDir;

/// In-memory copy of settings. Loaded once at startup, persisted on `save_settings`.
static SETTINGS: Lazy<Mutex<Settings>> = Lazy::new(|| Mutex::new(settings::load()));
static HBUILDERX_WEB_RUNS: Lazy<Mutex<HashMap<String, HBuilderXRunState>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
#[cfg(windows)]
static MANAGED_CHILD_JOB: Lazy<Result<isize, String>> = Lazy::new(create_managed_child_job);
const MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EditorScan {
    pub editor: Editor,
    pub exists: bool,
    pub extensions: Vec<Extension>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceEntry {
    pub name: String,
    pub path: String,
    pub relative_path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceFile {
    pub path: String,
    pub relative_path: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HBuilderXCliStatus {
    pub cli_path: Option<String>,
    pub exists: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HBuilderXRunWebRequest {
    pub cli_dir: String,
    pub project_path: String,
    pub options: HBuilderXRunWebConfig,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HBuilderXPublishAppResourceRequest {
    pub cli_dir: String,
    pub project_path: String,
    pub options: HBuilderXPublishAppResourceConfig,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HBuilderXCommandPreview {
    pub cli_path: String,
    pub args: Vec<String>,
    pub command: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HBuilderXRunResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub command: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HBuilderXPublishResult {
    pub success: bool,
    pub command_success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub command: String,
    pub error: Option<String>,
    pub copy_result: Option<FolderCopyResult>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderCopyResult {
    pub success: bool,
    pub source_dir: String,
    pub target_dir: String,
    pub copied: usize,
    pub failed: usize,
    pub failures: Vec<FolderCopyFailure>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderCopyFailure {
    pub source: String,
    pub target: String,
    pub error: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HBuilderXRunState {
    pub project_path: String,
    pub running: bool,
    pub pid: Option<u32>,
    pub command: String,
    pub stdout: String,
    pub stderr: String,
    pub success: Option<bool>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HBuilderXStopWebRequest {
    pub project_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HBuilderXStopResult {
    pub success: bool,
    pub pid: Option<u32>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HBuilderXStopAllResult {
    pub project_path: String,
    pub success: bool,
    pub pid: Option<u32>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HBuilderXRunLogEvent {
    pub project_path: String,
    pub stream: String,
    pub line: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HBuilderXRunExitEvent {
    pub project_path: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub command: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HBuilderXCliExport {
    pub version: u32,
    pub cli_dir: String,
    pub projects: Vec<HBuilderXProject>,
    #[serde(default)]
    pub project_groups: Vec<HBuilderXProjectGroup>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiConfigToolStatus {
    pub id: String,
    pub exists: bool,
    pub is_dir: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiConfigToolsExport {
    pub version: u32,
    pub tools: Vec<AiConfigTool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiConfigToolFile {
    pub name: String,
    pub path: String,
    pub exists: bool,
    pub is_dir: bool,
    pub description: String,
    pub known: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiConfigToolFiles {
    pub id: String,
    pub files: Vec<AiConfigToolFile>,
}

#[tauri::command]
pub fn list_editors() -> Vec<Editor> {
    SETTINGS.lock().unwrap().editors.clone()
}

#[tauri::command]
pub fn scan_extensions(editor_id: String) -> Result<EditorScan, String> {
    let editors = SETTINGS.lock().unwrap().editors.clone();
    let editor = editors
        .iter()
        .find(|e| e.id == editor_id)
        .ok_or_else(|| format!("editor '{editor_id}' not found"))?
        .clone();
    Ok(scan_one(editor))
}

#[tauri::command]
pub fn scan_all() -> Vec<EditorScan> {
    let editors = SETTINGS.lock().unwrap().editors.clone();
    editors.into_iter().map(scan_one).collect()
}

fn scan_one(editor: Editor) -> EditorScan {
    let path = editor.path_buf();
    let exists = path.exists();
    let extensions = if exists {
        scanner::scan_extensions(&path)
    } else {
        Vec::new()
    };
    EditorScan {
        editor,
        exists,
        extensions,
        error: None,
    }
}

#[tauri::command]
pub fn copy_extensions(tasks: Vec<CopyTask>, conflict_strategy: String) -> Vec<CopyResultItem> {
    tasks
        .iter()
        .map(|t| syncer::copy_extension(t, &conflict_strategy))
        .collect()
}

#[tauri::command]
pub fn scan_project_config_dirs(
    project_dir: String,
    config_dirs: Vec<String>,
) -> Result<Vec<ProjectConfigEntry>, String> {
    let dirs = if config_dirs.is_empty() {
        SETTINGS.lock().unwrap().project_config_dirs.clone()
    } else {
        config_dirs
    };
    syncer::scan_project_config_dirs(&project_dir, &dirs)
}

#[tauri::command]
pub fn sync_project_configs(
    tasks: Vec<ProjectConfigTask>,
    conflict_strategy: String,
) -> Vec<ProjectConfigResultItem> {
    tasks
        .iter()
        .map(|t| syncer::sync_project_config(t, &conflict_strategy))
        .collect()
}

#[tauri::command]
pub fn resolve_hbuilderx_cli(cli_dir: String) -> HBuilderXCliStatus {
    match resolve_cli_path(&cli_dir) {
        Ok(path) => HBuilderXCliStatus {
            cli_path: Some(path_to_display_string(&path)),
            exists: true,
            error: None,
        },
        Err(error) => HBuilderXCliStatus {
            cli_path: None,
            exists: false,
            error: Some(error),
        },
    }
}

#[tauri::command]
pub fn preview_hbuilderx_run_web(
    request: HBuilderXRunWebRequest,
) -> Result<HBuilderXCommandPreview, String> {
    build_hbuilderx_run_web_command(&request)
}

#[tauri::command]
pub fn preview_hbuilderx_publish_app_resource(
    request: HBuilderXPublishAppResourceRequest,
) -> Result<HBuilderXCommandPreview, String> {
    build_hbuilderx_publish_app_resource_command(&request)
}

#[tauri::command]
pub fn run_hbuilderx_publish_app_resource(
    request: HBuilderXPublishAppResourceRequest,
) -> HBuilderXPublishResult {
    let preview = match build_hbuilderx_publish_app_resource_command(&request) {
        Ok(preview) => preview,
        Err(error) => {
            return HBuilderXPublishResult {
                success: false,
                command_success: false,
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                command: String::new(),
                error: Some(error),
                copy_result: None,
            }
        }
    };

    let mut command = Command::new(&preview.cli_path);
    command.args(&preview.args);
    configure_hidden_process(&mut command);
    let output = match command.output() {
        Ok(output) => output,
        Err(error) => {
            return HBuilderXPublishResult {
                success: false,
                command_success: false,
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                command: preview.command,
                error: Some(error.to_string()),
                copy_result: None,
            }
        }
    };

    let command_success = output.status.success();
    let stdout = clean_process_output(&decode_process_bytes(&output.stdout));
    let stderr = clean_process_output(&decode_process_bytes(&output.stderr));
    let mut copy_result = None;
    let mut error = if command_success {
        None
    } else if stderr.trim().is_empty() {
        Some(format!(
            "HBuilderX CLI exited with status {}",
            output.status
        ))
    } else {
        Some(stderr.clone())
    };
    let mut success = command_success;

    if command_success && request.options.copy_enabled {
        let result = copy_folder_contents(
            &request.options.copy_source_dir,
            &request.options.copy_target_dir,
        );
        if !result.success {
            success = false;
            error = Some("发行成功，但复制失败".into());
        }
        copy_result = Some(result);
    }

    HBuilderXPublishResult {
        success,
        command_success,
        exit_code: output.status.code(),
        stdout,
        stderr,
        command: preview.command,
        error,
        copy_result,
    }
}

#[tauri::command]
pub fn run_hbuilderx_web(
    app: tauri::AppHandle,
    request: HBuilderXRunWebRequest,
) -> HBuilderXRunResult {
    let preview = match build_hbuilderx_run_web_command(&request) {
        Ok(preview) => preview,
        Err(error) => {
            return HBuilderXRunResult {
                success: false,
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                command: String::new(),
                error: Some(error),
            }
        }
    };

    let project_path = match canonical_project_path(&request.project_path) {
        Ok(path) => path,
        Err(error) => {
            return HBuilderXRunResult {
                success: false,
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                command: preview.command,
                error: Some(error),
            }
        }
    };
    let run_key = running_project_key(&project_path);

    if let Some(existing) = HBUILDERX_WEB_RUNS
        .lock()
        .unwrap()
        .get(&run_key)
        .filter(|existing| existing.running)
        .cloned()
    {
        return HBuilderXRunResult {
            success: false,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            command: existing.command,
            error: Some(format!(
                "项目已在运行，PID: {}",
                existing
                    .pid
                    .map(|pid| pid.to_string())
                    .unwrap_or_else(|| "unknown".into())
            )),
        };
    }

    let mut command = Command::new(&preview.cli_path);
    command
        .args(&preview.args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_hidden_process(&mut command);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return HBuilderXRunResult {
                success: false,
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                command: preview.command,
                error: Some(error.to_string()),
            }
        }
    };
    if let Err(error) = attach_child_to_managed_job(&child) {
        let _ = child.kill();
        let _ = child.wait();
        return HBuilderXRunResult {
            success: false,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            command: preview.command,
            error: Some(error),
        };
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let pid = child.id();
    let project_path = path_to_display_string(&project_path);
    let command = preview.command.clone();
    HBUILDERX_WEB_RUNS.lock().unwrap().insert(
        run_key.clone(),
        HBuilderXRunState {
            project_path: project_path.clone(),
            running: true,
            pid: Some(pid),
            command: preview.command.clone(),
            stdout: String::new(),
            stderr: String::new(),
            success: None,
            exit_code: None,
            error: None,
        },
    );
    let app_for_wait = app.clone();
    std::thread::spawn(move || {
        let stdout_handle = stdout.map(|stream| {
            let app = app_for_wait.clone();
            let project_path = project_path.clone();
            let run_key = run_key.clone();
            std::thread::spawn(move || {
                read_process_stream(app, run_key, project_path, "stdout", stream)
            })
        });
        let stderr_handle = stderr.map(|stream| {
            let app = app_for_wait.clone();
            let project_path = project_path.clone();
            let run_key = run_key.clone();
            std::thread::spawn(move || {
                read_process_stream(app, run_key, project_path, "stderr", stream)
            })
        });
        let wait_result = child.wait();
        let stdout = stdout_handle
            .and_then(|handle| handle.join().ok())
            .unwrap_or_default();
        let stderr = stderr_handle
            .and_then(|handle| handle.join().ok())
            .unwrap_or_default();
        let (success, exit_code, error) = match wait_result {
            Ok(status) => (status.success(), status.code(), None),
            Err(error) => (false, None, Some(error.to_string())),
        };
        if let Some(run) = HBUILDERX_WEB_RUNS.lock().unwrap().get_mut(&run_key) {
            run.running = false;
            run.pid = None;
            run.stdout = stdout.clone();
            run.stderr = stderr.clone();
            run.success = Some(success);
            run.exit_code = exit_code;
            run.error = error.clone();
        }
        let _ = app_for_wait.emit(
            "hbuilderx-run-exit",
            HBuilderXRunExitEvent {
                project_path,
                success,
                exit_code,
                stdout,
                stderr,
                command,
                error,
            },
        );
    });

    HBuilderXRunResult {
        success: true,
        exit_code: None,
        stdout: String::new(),
        stderr: String::new(),
        command: preview.command,
        error: None,
    }
}

#[tauri::command]
pub fn get_hbuilderx_web_runs() -> Vec<HBuilderXRunState> {
    HBUILDERX_WEB_RUNS
        .lock()
        .unwrap()
        .values()
        .cloned()
        .collect()
}

#[tauri::command]
pub fn stop_all_hbuilderx_web_runs() -> Vec<HBuilderXStopAllResult> {
    let runs: Vec<HBuilderXRunState> = HBUILDERX_WEB_RUNS
        .lock()
        .unwrap()
        .values()
        .filter(|run| run.running)
        .cloned()
        .collect();

    runs.into_iter()
        .map(|run| {
            let Some(pid) = run.pid else {
                return HBuilderXStopAllResult {
                    project_path: run.project_path,
                    success: false,
                    pid: None,
                    error: Some("项目当前没有可停止的 WEB 进程".into()),
                };
            };
            match kill_process_tree(pid) {
                Ok(()) => HBuilderXStopAllResult {
                    project_path: run.project_path,
                    success: true,
                    pid: Some(pid),
                    error: None,
                },
                Err(error) => HBuilderXStopAllResult {
                    project_path: run.project_path,
                    success: false,
                    pid: Some(pid),
                    error: Some(error),
                },
            }
        })
        .collect()
}

#[tauri::command]
pub fn stop_hbuilderx_web(request: HBuilderXStopWebRequest) -> HBuilderXStopResult {
    let project_path = match canonical_project_path(&request.project_path) {
        Ok(path) => path,
        Err(error) => {
            return HBuilderXStopResult {
                success: false,
                pid: None,
                error: Some(error),
            }
        }
    };
    let run_key = running_project_key(&project_path);
    let running = HBUILDERX_WEB_RUNS
        .lock()
        .unwrap()
        .get(&run_key)
        .filter(|run| run.running)
        .cloned();
    let Some(running) = running else {
        return HBuilderXStopResult {
            success: false,
            pid: None,
            error: Some("项目当前没有运行中的 WEB 进程".into()),
        };
    };
    let Some(pid) = running.pid else {
        return HBuilderXStopResult {
            success: false,
            pid: None,
            error: Some("项目当前没有可停止的 WEB 进程".into()),
        };
    };

    match kill_process_tree(pid) {
        Ok(()) => HBuilderXStopResult {
            success: true,
            pid: Some(pid),
            error: None,
        },
        Err(error) => HBuilderXStopResult {
            success: false,
            pid: Some(pid),
            error: Some(error),
        },
    }
}

#[tauri::command]
pub fn export_hbuilderx_cli_config(
    path: String,
    project_ids: Option<Vec<String>>,
) -> Result<(), String> {
    let settings = SETTINGS.lock().unwrap().clone();
    let (projects, project_groups) = match project_ids {
        Some(ids) if !ids.is_empty() => {
            let selected: HashSet<String> = ids.into_iter().collect();
            let projects = settings
                .hbuilderx_projects
                .into_iter()
                .filter(|project| selected.contains(&project.id))
                .collect();
            let project_groups = settings
                .hbuilderx_project_groups
                .into_iter()
                .filter_map(|mut group| {
                    group.project_ids.retain(|id| selected.contains(id));
                    if group.project_ids.is_empty() {
                        None
                    } else {
                        Some(group)
                    }
                })
                .collect();
            (projects, project_groups)
        }
        _ => (
            settings.hbuilderx_projects,
            settings.hbuilderx_project_groups,
        ),
    };
    let export = HBuilderXCliExport {
        version: 1,
        cli_dir: settings.hbuilderx_cli_dir,
        projects,
        project_groups,
    };
    let json = serde_json::to_string_pretty(&export).map_err(|e| e.to_string())?;
    fs::write(normalize_input_path(&path), json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_hbuilderx_cli_config(path: String) -> Result<Settings, String> {
    let content = fs::read_to_string(normalize_input_path(&path)).map_err(|e| e.to_string())?;
    let import: HBuilderXCliExport = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let mut settings = SETTINGS.lock().unwrap().clone();
    if !import.cli_dir.trim().is_empty() {
        settings.hbuilderx_cli_dir = import.cli_dir;
    }
    for project in import.projects {
        if let Some(existing) = settings
            .hbuilderx_projects
            .iter_mut()
            .find(|item| item.id == project.id)
        {
            *existing = project;
        } else {
            settings.hbuilderx_projects.push(project);
        }
    }
    for group in import.project_groups {
        if let Some(existing) = settings
            .hbuilderx_project_groups
            .iter_mut()
            .find(|item| item.id == group.id)
        {
            *existing = group;
        } else {
            settings.hbuilderx_project_groups.push(group);
        }
    }
    settings::save(&settings)?;
    *SETTINGS.lock().unwrap() = settings.clone();
    Ok(settings)
}

#[tauri::command]
pub fn get_ai_config_tool_statuses() -> Vec<AiConfigToolStatus> {
    SETTINGS
        .lock()
        .unwrap()
        .ai_config_tools
        .iter()
        .map(|tool| {
            let normalized = normalize_input_path(&tool.config_dir);
            let path = Path::new(&normalized);
            AiConfigToolStatus {
                id: tool.id.clone(),
                exists: path.exists(),
                is_dir: path.is_dir(),
            }
        })
        .collect()
}

#[tauri::command]
pub fn get_ai_config_tool_files() -> Vec<AiConfigToolFiles> {
    SETTINGS
        .lock()
        .unwrap()
        .ai_config_tools
        .iter()
        .map(|tool| AiConfigToolFiles {
            id: tool.id.clone(),
            files: collect_ai_config_files(&tool.id, &normalize_input_path(&tool.config_dir)),
        })
        .collect()
}

fn known_ai_config_files(tool_id: &str) -> Option<Vec<(&'static str, &'static str)>> {
    match tool_id {
        "claude" => Some(vec![
            ("settings.json", "用户级全局设置：权限、模型、Hooks 等"),
            ("CLAUDE.md", "用户级记忆：对所有项目生效的个人指令"),
            ("rules", "用户级规则目录：可按文件路径定向加载"),
            ("commands", "自定义斜杠命令"),
            ("agents", "子代理定义"),
            ("skills", "技能目录"),
        ]),
        "codex" => Some(vec![
            ("config.toml", "全局配置：模型、审批策略、沙箱、MCP 服务器"),
            ("AGENTS.md", "全局指令：所有项目通用"),
            ("auth.json", "登录凭据"),
            ("prompts", "自定义提示词模板"),
        ]),
        "opencode" => Some(vec![
            ("opencode.json", "全局配置（亦支持 opencode.jsonc）"),
            ("opencode.jsonc", "全局配置：带注释的 JSONC 变体"),
            ("tui.json", "终端界面配置（亦支持 tui.jsonc）"),
            ("tui.jsonc", "终端界面配置：带注释的 JSONC 变体"),
            ("AGENTS.md", "全局规则：所有会话加载"),
            ("agents", "自定义 Agent 定义"),
            ("commands", "自定义命令"),
            ("plugins", "插件目录"),
            ("skills", "技能目录"),
        ]),
        "pi" => Some(vec![
            ("settings.json", "用户设置与 Pi 包声明"),
            ("keybindings.json", "自定义键位绑定"),
            ("mcp.json", "全局 MCP 服务器配置"),
            ("models.json", "模型与兼容端点配置"),
            ("auth.json", "API Key 与 OAuth 凭据"),
            ("AGENTS.md", "用户全局指令（亦支持 CLAUDE.md）"),
            ("SYSTEM.md", "替换默认系统提示词"),
            ("APPEND_SYSTEM.md", "向系统提示词追加内容"),
            ("extensions", "扩展目录"),
            ("skills", "技能目录"),
            ("prompts", "提示词模板：以斜杠命令调用"),
            ("themes", "主题文件"),
        ]),
        "grok" => Some(vec![
            ("user-settings.json", "用户设置：API Key、子代理、Hooks 等"),
            ("workspace-trust.json", "工作区信任记录"),
        ]),
        "antigravity-cli" => Some(vec![
            ("settings.json", "持久化设置：仅保存与默认值不同的项"),
            ("keybindings.json", "自定义键位绑定"),
        ]),
        "zcode" => Some(vec![
            ("v2/config.json", "全局配置：模型、提供商、界面设置"),
            ("v2/provider_config.json", "模型提供商配置：API 密钥与端点"),
            ("v2/setting.json", "用户设置：模型选择与提供商模式"),
            ("v2/credentials.json", "登录凭据与 OAuth 令牌"),
            ("cli/agents", "子代理定义目录"),
            ("cli/plugins", "插件目录：技能、命令、MCP 服务器"),
        ]),
        _ => None,
    }
}

fn collect_ai_config_files(tool_id: &str, config_dir: &str) -> Vec<AiConfigToolFile> {
    let dir = Path::new(config_dir);
    if let Some(known) = known_ai_config_files(tool_id) {
        return known
            .into_iter()
            .map(|(name, description)| {
                let path = dir.join(name);
                AiConfigToolFile {
                    name: name.to_string(),
                    path: path.to_string_lossy().to_string(),
                    exists: path.exists(),
                    is_dir: path.is_dir(),
                    description: description.to_string(),
                    known: true,
                }
            })
            .collect();
    }
    let mut files: Vec<AiConfigToolFile> = match fs::read_dir(dir) {
        Ok(entries) => entries
            .filter_map(|entry| entry.ok())
            .map(|entry| {
                let path = entry.path();
                AiConfigToolFile {
                    name: entry.file_name().to_string_lossy().to_string(),
                    path: path.to_string_lossy().to_string(),
                    exists: true,
                    is_dir: path.is_dir(),
                    description: "目录中的文件".to_string(),
                    known: false,
                }
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files
}

#[tauri::command]
pub fn export_ai_config_tools(path: String) -> Result<(), String> {
    let tools = SETTINGS.lock().unwrap().ai_config_tools.clone();
    let export = AiConfigToolsExport { version: 1, tools };
    let json = serde_json::to_string_pretty(&export).map_err(|e| e.to_string())?;
    fs::write(normalize_input_path(&path), json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_ai_config_tools(path: String) -> Result<Settings, String> {
    let content = fs::read_to_string(normalize_input_path(&path)).map_err(|e| e.to_string())?;
    let incoming = parse_ai_config_tools_export(&content)?;

    let mut settings = SETTINGS.lock().unwrap().clone();
    merge_ai_config_tools(&mut settings.ai_config_tools, incoming);
    settings::save(&settings)?;
    *SETTINGS.lock().unwrap() = settings.clone();
    Ok(settings)
}

fn parse_ai_config_tools_export(content: &str) -> Result<Vec<AiConfigTool>, String> {
    let import: AiConfigToolsExport =
        serde_json::from_str(content).map_err(|e| format!("AI 配置清单 JSON 格式无效: {e}"))?;
    if import.version != 1 {
        return Err(format!("不支持的 AI 配置清单版本: {}", import.version));
    }
    normalize_ai_config_tools(import.tools)
}

fn merge_ai_config_tools(existing: &mut Vec<AiConfigTool>, incoming: Vec<AiConfigTool>) {
    for tool in incoming {
        if let Some(item) = existing.iter_mut().find(|item| item.id == tool.id) {
            *item = tool;
        } else {
            existing.push(tool);
        }
    }
}

fn normalize_ai_config_tools(tools: Vec<AiConfigTool>) -> Result<Vec<AiConfigTool>, String> {
    let mut ids = HashSet::new();
    let mut normalized = Vec::with_capacity(tools.len());
    for mut tool in tools {
        tool.id = tool.id.trim().to_string();
        tool.name = tool.name.trim().to_string();
        tool.config_dir = normalize_input_path(tool.config_dir.trim());
        if tool.id.is_empty() || tool.name.is_empty() || tool.config_dir.is_empty() {
            return Err("AI 配置清单中的条目必须包含 id、name 和 config_dir".into());
        }
        if !ids.insert(tool.id.clone()) {
            return Err(format!("AI 配置清单包含重复的条目 ID: {}", tool.id));
        }
        if !Path::new(&tool.config_dir).is_absolute() {
            return Err(format!("AI 配置目录必须是绝对路径: {}", tool.config_dir));
        }
        normalized.push(tool);
    }
    Ok(normalized)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeleteTask {
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeleteResultItem {
    pub path: String,
    pub success: bool,
    pub trash_path: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn delete_extensions(tasks: Vec<DeleteTask>) -> Vec<DeleteResultItem> {
    // Refuse to delete from the source editor — primary source must be preserved.
    let source_id = SETTINGS.lock().unwrap().source_editor.clone();
    let source_path = SETTINGS
        .lock()
        .unwrap()
        .editors
        .iter()
        .find(|e| e.id == source_id)
        .map(|e| e.path.clone())
        .unwrap_or_default();
    let source_canonical = std::fs::canonicalize(&source_path)
        .ok()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(source_path.clone());

    tasks
        .iter()
        .map(|t| {
            let p = PathBuf::from(&t.path);
            // protective check: refuse if path resides under the source editor's folder
            if let Ok(canon) = std::fs::canonicalize(&p) {
                let canon_str = canon.to_string_lossy().to_string();
                if !source_canonical.is_empty() && canon_str.starts_with(&source_canonical) {
                    return DeleteResultItem {
                        path: t.path.clone(),
                        success: false,
                        trash_path: None,
                        error: Some("refusing to delete from source editor".into()),
                    };
                }
            }
            match syncer::move_to_trash(&p) {
                Ok(tp) => DeleteResultItem {
                    path: t.path.clone(),
                    success: true,
                    trash_path: Some(tp.to_string_lossy().to_string()),
                    error: None,
                },
                Err(e) => DeleteResultItem {
                    path: t.path.clone(),
                    success: false,
                    trash_path: None,
                    error: Some(e),
                },
            }
        })
        .collect()
}

#[tauri::command]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    use std::process::Command;
    // Windows Explorer silently falls back to Documents when given a path with
    // mixed `/` and `\` separators. Normalize before launching.
    let normalized = path.replace('/', "\\");
    if !std::path::Path::new(&normalized).exists() {
        return Err(format!("path does not exist: {normalized}"));
    }
    Command::new("explorer.exe")
        .arg(&normalized)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn open_folder_window(app: tauri::AppHandle, path: String) -> Result<(), String> {
    open_path_window(&app, path)
}

#[tauri::command]
pub async fn open_with_method(
    app: tauri::AppHandle,
    method_id: String,
    path: String,
) -> Result<(), String> {
    let method = {
        let settings = SETTINGS.lock().unwrap();
        settings
            .open_methods
            .iter()
            .find(|m| m.id == method_id)
            .cloned()
            .ok_or_else(|| format!("打开方式不存在: {method_id}"))?
    };
    open_path_with_method(&app, &method, path)
}

pub fn open_default_path(app: &tauri::AppHandle, path: String) -> Result<(), String> {
    let settings = SETTINGS.lock().unwrap().clone();
    let method = resolve_primary_open_method(&settings)
        .ok_or_else(|| "没有可用的打开方式，请检查设置中的启用状态和程序路径。".to_string())?;
    open_path_with_method(app, method, path)
}

fn resolve_primary_open_method(settings: &Settings) -> Option<&OpenMethod> {
    let is_ready = |method: &&OpenMethod| {
        method.enabled
            && (method.kind != OpenMethodKind::ExternalApp || !method.command.trim().is_empty())
    };
    settings
        .open_methods
        .iter()
        .find(|method| method.id == settings.default_open_method_id)
        .filter(is_ready)
        .or_else(|| settings.open_methods.iter().find(is_ready))
}

fn open_path_with_method(
    app: &tauri::AppHandle,
    method: &OpenMethod,
    path: String,
) -> Result<(), String> {
    if !method.enabled {
        return Err(format!("打开方式已禁用: {}", method.name));
    }
    match method.kind {
        OpenMethodKind::Explorer => open_in_explorer(path),
        OpenMethodKind::Workspace => open_path_window(app, path),
        OpenMethodKind::ExternalApp => open_with_external_app(method, path),
    }
}

fn open_with_external_app(method: &OpenMethod, path: String) -> Result<(), String> {
    use std::process::Command;

    let command = method.command.trim();
    if command.is_empty() {
        return Err(format!(
            "请先在设置中配置「{}」的可执行文件路径",
            method.name
        ));
    }

    let normalized = normalize_input_path(&path);
    if !Path::new(&normalized).exists() {
        return Err(format!("path does not exist: {normalized}"));
    }

    if command.contains('\\') || command.contains('/') {
        let cmd_path = Path::new(command);
        if !cmd_path.exists() {
            return Err(format!("可执行文件不存在: {command}"));
        }
    }

    let args = settings::render_open_args_template(&method.args_template, &normalized);
    Command::new(command)
        .args(&args)
        .spawn()
        .map_err(|e| format!("启动「{}」失败: {e}", method.name))?;
    Ok(())
}

pub fn open_path_window(app: &tauri::AppHandle, path: String) -> Result<(), String> {
    let normalized = normalize_input_path(&path);
    let input = fs::canonicalize(&normalized)
        .map_err(|e| format!("path does not exist: {normalized}: {e}"))?;

    let (root, initial_file, single_file) = if input.is_dir() {
        (input, None, false)
    } else if input.is_file() {
        let parent = input
            .parent()
            .ok_or_else(|| format!("file has no parent directory: {}", input.to_string_lossy()))?
            .to_path_buf();
        let relative = input
            .strip_prefix(&parent)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        (parent, Some(relative), true)
    } else {
        return Err(format!(
            "path is neither a file nor a directory: {}",
            input.to_string_lossy()
        ));
    };

    let root_str = path_to_display_string(&root);
    let label_source = initial_file
        .as_ref()
        .map(|file| format!("{root_str}/{file}"))
        .unwrap_or_else(|| root_str.clone());
    let label = workspace_window_label(&label_source);
    let mut url = format!("index.html?workspace={}", encode_uri_component(&root_str));
    if let Some(file) = &initial_file {
        url.push_str("&file=");
        url.push_str(&encode_uri_component(file));
    }
    if single_file {
        url.push_str("&singleFile=1");
    }
    let title_path = if single_file {
        PathBuf::from(&normalized)
    } else {
        root.clone()
    };
    let title = title_path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(&root_str);

    WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(format!("{title} - Workspace"))
        .inner_size(1280.0, 820.0)
        .min_inner_size(960.0, 600.0)
        .resizable(true)
        .decorations(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn read_workspace_dir(
    root: String,
    relative_path: String,
) -> Result<Vec<WorkspaceEntry>, String> {
    let (root_path, dir_path) = resolve_workspace_path(&root, &relative_path)?;
    if !dir_path.is_dir() {
        return Err(format!(
            "workspace path is not a directory: {}",
            dir_path.to_string_lossy()
        ));
    }

    let mut entries = Vec::new();
    for item in fs::read_dir(&dir_path).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let path = item.path();
        let metadata = item.metadata().map_err(|e| e.to_string())?;
        let is_dir = metadata.is_dir();
        let relative = path
            .strip_prefix(&root_path)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        entries.push(WorkspaceEntry {
            name: item.file_name().to_string_lossy().to_string(),
            path: path_to_display_string(&path),
            relative_path: relative,
            is_dir,
            size_bytes: if is_dir { 0 } else { metadata.len() },
        });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

#[tauri::command]
pub fn read_workspace_file(root: String, relative_path: String) -> Result<WorkspaceFile, String> {
    let (root_path, file_path) = resolve_workspace_path(&root, &relative_path)?;
    if !file_path.is_file() {
        return Err(format!(
            "workspace path is not a file: {}",
            file_path.to_string_lossy()
        ));
    }
    let metadata = fs::metadata(&file_path).map_err(|e| e.to_string())?;
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(format!(
            "file is too large to edit: {} bytes",
            metadata.len()
        ));
    }
    let bytes = fs::read(&file_path).map_err(|e| e.to_string())?;
    if bytes.contains(&0) {
        return Err("binary files are not editable".into());
    }
    let content = String::from_utf8(bytes).map_err(|_| "file is not valid UTF-8".to_string())?;
    let relative = file_path
        .strip_prefix(&root_path)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    Ok(WorkspaceFile {
        path: path_to_display_string(&file_path),
        relative_path: relative,
        content,
    })
}

#[tauri::command]
pub fn write_workspace_file(
    root: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let (_, file_path) = resolve_workspace_path(&root, &relative_path)?;
    if !file_path.is_file() {
        return Err(format!(
            "workspace path is not a file: {}",
            file_path.to_string_lossy()
        ));
    }
    fs::write(&file_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings() -> Settings {
    SETTINGS.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_settings(settings: Settings) -> Result<(), String> {
    let settings = settings::normalize_terminal_settings(settings)?;
    let settings = settings::normalize_open_method_settings(settings)?;
    settings::save(&settings)?;
    *SETTINGS.lock().unwrap() = settings;
    Ok(())
}

#[tauri::command]
pub fn list_terminal_sessions() -> Vec<TerminalSession> {
    terminal::list_sessions()
}

#[tauri::command]
pub fn filter_terminal_project_directories(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .map(|path| normalize_input_path(&path))
        .filter(|path| Path::new(path).is_dir())
        .collect()
}

#[tauri::command]
pub fn launch_terminal_session(
    project_id: String,
    tool_id: String,
    force_new: bool,
) -> Result<TerminalLaunchResult, String> {
    let settings = SETTINGS.lock().unwrap().clone();
    let project = settings
        .terminal_projects
        .iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| format!("AI 终端项目不存在: {project_id}"))?;
    let tool = settings
        .terminal_ai_tools
        .iter()
        .find(|tool| tool.id == tool_id)
        .ok_or_else(|| format!("AI 终端工具不存在: {tool_id}"))?;
    if !project.tool_ids.iter().any(|id| id == &tool.id) {
        return Err(format!("项目“{}”未绑定工具“{}”", project.name, tool.name));
    }
    let path = Path::new(&project.path);
    if !path.is_dir() {
        return Err(format!("项目目录不存在或不是目录: {}", project.path));
    }
    let env = settings::resolve_terminal_env(&settings);
    terminal::launch_session(project, tool, force_new, &env)
}

#[tauri::command]
pub fn focus_terminal_session(session_id: String) -> TerminalActionResult {
    terminal::focus_session(&session_id)
}

#[tauri::command]
pub fn close_terminal_session(session_id: String) -> TerminalActionResult {
    terminal::close_session(&session_id)
}

#[tauri::command]
pub fn close_terminal_project_sessions(project_id: String) -> TerminalActionResult {
    terminal::close_project_sessions(&project_id)
}

#[tauri::command]
pub fn close_terminal_tool_sessions(tool_id: String) -> TerminalActionResult {
    terminal::close_tool_sessions(&tool_id)
}

#[tauri::command]
pub fn check_running_processes(editor_ids: Vec<String>) -> Vec<String> {
    use sysinfo::{ProcessesToUpdate, System};
    let editors = SETTINGS.lock().unwrap().editors.clone();
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let targets: Vec<(String, Vec<String>)> = editors
        .iter()
        .filter(|e| editor_ids.contains(&e.id))
        .map(|e| {
            (
                e.id.clone(),
                e.process_names.iter().map(|n| n.to_lowercase()).collect(),
            )
        })
        .collect();
    let mut running = Vec::new();
    for (id, names) in targets {
        let is_running = sys.processes().values().any(|p| {
            let proc_name = p.name().to_string_lossy().to_lowercase();
            names.iter().any(|n| n == &proc_name)
        });
        if is_running {
            running.push(id);
        }
    }
    running
}

#[tauri::command]
pub fn purge_trash() -> Result<(), String> {
    let days = SETTINGS.lock().unwrap().backup_days;
    syncer::purge_old_trash(days);
    Ok(())
}

pub(crate) fn normalize_input_path(path: &str) -> String {
    if cfg!(windows) {
        path.replace('/', "\\")
    } else {
        path.to_string()
    }
}

fn resolve_cli_path(cli_dir: &str) -> Result<PathBuf, String> {
    let trimmed = cli_dir.trim();
    if trimmed.is_empty() {
        return Err("HBuilderX CLI folder is not configured".into());
    }
    let dir = PathBuf::from(normalize_input_path(trimmed));
    if !dir.exists() {
        return Err(format!("HBuilderX CLI folder does not exist: {trimmed}"));
    }
    if !dir.is_dir() {
        return Err(format!("HBuilderX CLI path is not a folder: {trimmed}"));
    }
    let cli_name = if cfg!(windows) { "cli.exe" } else { "cli" };
    let cli_path = dir.join(cli_name);
    if !cli_path.is_file() {
        return Err(format!(
            "HBuilderX CLI executable not found: {}",
            cli_path.to_string_lossy()
        ));
    }
    Ok(cli_path)
}

fn build_hbuilderx_run_web_command(
    request: &HBuilderXRunWebRequest,
) -> Result<HBuilderXCommandPreview, String> {
    let cli_path = resolve_cli_path(&request.cli_dir)?;
    let project_path = canonical_project_path(&request.project_path)?;

    let mut args = vec![
        "launch".to_string(),
        "web".to_string(),
        "--project".to_string(),
        path_to_display_string(&project_path),
    ];
    let browser = request.options.browser.trim();
    if !browser.is_empty() {
        args.push("--browser".into());
        args.push(browser.to_string());
    }
    if request.options.ui {
        args.push("--ui".into());
        args.push("true".into());
    }
    if request.options.compile {
        args.push("--compile".into());
        args.push("true".into());
    }
    if request.options.continue_on_error {
        args.push("--continue-on-error".into());
        args.push("true".into());
    }
    let cli_path = path_to_display_string(&cli_path);
    let command = display_command(&cli_path, &args);
    Ok(HBuilderXCommandPreview {
        cli_path,
        args,
        command,
    })
}

fn build_hbuilderx_publish_app_resource_command(
    request: &HBuilderXPublishAppResourceRequest,
) -> Result<HBuilderXCommandPreview, String> {
    let cli_path = resolve_cli_path(&request.cli_dir)?;
    let project_path = canonical_project_path(&request.project_path)?;
    let platform = request.options.platform.trim();
    let platform = if platform.is_empty() { "APP" } else { platform };

    let mut args = vec!["publish".to_string()];
    match platform {
        "APP" => {
            args.push("--platform".into());
            args.push("APP".into());
        }
        "app-ios" | "app-android" => {
            args.push(platform.to_string());
        }
        _ => {
            return Err(format!(
                "unsupported appResource platform: {platform}. Use APP, app-ios, or app-android"
            ));
        }
    }
    args.push("--type".into());
    args.push("appResource".into());
    args.push("--project".into());
    args.push(path_to_display_string(&project_path));

    let cli_path = path_to_display_string(&cli_path);
    let command = display_command(&cli_path, &args);
    Ok(HBuilderXCommandPreview {
        cli_path,
        args,
        command,
    })
}

fn copy_folder_contents(source_dir: &str, target_dir: &str) -> FolderCopyResult {
    let source_input = normalize_input_path(source_dir.trim());
    let target_input = normalize_input_path(target_dir.trim());
    let mut result = FolderCopyResult {
        success: false,
        source_dir: source_input.clone(),
        target_dir: target_input.clone(),
        copied: 0,
        failed: 0,
        failures: Vec::new(),
        error: None,
    };

    if source_input.is_empty() {
        result.error = Some("复制源文件夹未配置".into());
        return result;
    }
    if target_input.is_empty() {
        result.error = Some("复制目标文件夹未配置".into());
        return result;
    }

    let source = match fs::canonicalize(&source_input) {
        Ok(path) if path.is_dir() => path,
        Ok(path) => {
            result.error = Some(format!("复制源路径不是文件夹: {}", path.to_string_lossy()));
            return result;
        }
        Err(error) => {
            result.error = Some(format!("复制源文件夹不存在: {source_input}: {error}"));
            return result;
        }
    };

    let target = PathBuf::from(&target_input);
    if target.exists() && !target.is_dir() {
        result.error = Some(format!("复制目标路径不是文件夹: {target_input}"));
        return result;
    }
    if let Err(error) = fs::create_dir_all(&target) {
        result.error = Some(format!("无法创建复制目标文件夹: {target_input}: {error}"));
        return result;
    }
    let target = match fs::canonicalize(&target) {
        Ok(path) => path,
        Err(error) => {
            result.error = Some(format!("无法解析复制目标文件夹: {target_input}: {error}"));
            return result;
        }
    };

    result.source_dir = path_to_display_string(&source);
    result.target_dir = path_to_display_string(&target);

    if source == target {
        result.error = Some("复制源文件夹和目标文件夹不能相同".into());
        return result;
    }
    if target.starts_with(&source) {
        result.error = Some("复制目标文件夹不能位于源文件夹内部".into());
        return result;
    }

    for entry in WalkDir::new(&source).into_iter() {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                result.failed += 1;
                result.failures.push(FolderCopyFailure {
                    source: String::new(),
                    target: String::new(),
                    error: error.to_string(),
                });
                continue;
            }
        };
        let path = entry.path();
        if path == source || entry.file_type().is_dir() {
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = match path.strip_prefix(&source) {
            Ok(relative) => relative,
            Err(error) => {
                result.failed += 1;
                result.failures.push(FolderCopyFailure {
                    source: path_to_display_string(path),
                    target: String::new(),
                    error: error.to_string(),
                });
                continue;
            }
        };
        let target_path = target.join(relative);
        if let Some(parent) = target_path.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                result.failed += 1;
                result.failures.push(FolderCopyFailure {
                    source: path_to_display_string(path),
                    target: path_to_display_string(&target_path),
                    error: error.to_string(),
                });
                continue;
            }
        }
        match fs::copy(path, &target_path) {
            Ok(_) => {
                result.copied += 1;
            }
            Err(error) => {
                result.failed += 1;
                result.failures.push(FolderCopyFailure {
                    source: path_to_display_string(path),
                    target: path_to_display_string(&target_path),
                    error: error.to_string(),
                });
            }
        }
    }

    result.success = result.failed == 0;
    if !result.success && result.error.is_none() {
        result.error = Some(format!("{} 个文件复制失败", result.failed));
    }
    result
}

pub(crate) fn canonical_project_path(project_path: &str) -> Result<PathBuf, String> {
    let project_path = fs::canonicalize(normalize_input_path(project_path))
        .map_err(|e| format!("project path does not exist: {project_path}: {e}"))?;
    if !project_path.is_dir() {
        return Err(format!(
            "project path is not a folder: {}",
            project_path.to_string_lossy()
        ));
    }
    Ok(project_path)
}

fn running_project_key(project_path: &Path) -> String {
    let value = path_to_display_string(project_path);
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

#[cfg(windows)]
pub(crate) fn configure_hidden_process(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(crate) fn configure_hidden_process(_: &mut Command) {}

#[cfg(windows)]
fn create_managed_child_job() -> Result<isize, String> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::JobObjects::{
        CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job == std::ptr::null_mut() || job == INVALID_HANDLE_VALUE {
            return Err(format!(
                "无法创建受管子进程保护 Job: {}",
                std::io::Error::last_os_error()
            ));
        }

        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
            let error = std::io::Error::last_os_error();
            let _ = CloseHandle(job);
            return Err(format!("无法配置受管子进程保护 Job: {error}"));
        }

        Ok(job as isize)
    }
}

#[cfg(windows)]
pub(crate) fn attach_child_to_managed_job(child: &std::process::Child) -> Result<(), String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;

    let job = *MANAGED_CHILD_JOB.as_ref().map_err(|error| error.clone())? as HANDLE;
    let process = child.as_raw_handle() as HANDLE;
    unsafe {
        if AssignProcessToJobObject(job, process) == 0 {
            return Err(format!(
                "无法把子进程加入保护 Job: {}",
                std::io::Error::last_os_error()
            ));
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub(crate) fn attach_child_to_managed_job(_: &std::process::Child) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
pub(crate) fn kill_process_tree(pid: u32) -> Result<(), String> {
    let pid = pid.to_string();
    let mut command = Command::new("taskkill.exe");
    command
        .args(["/PID", &pid, "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    configure_hidden_process(&mut command);
    let output = command.output().map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        let error = decode_process_bytes(&output.stderr);
        Err(if error.trim().is_empty() {
            format!("taskkill failed with status {}", output.status)
        } else {
            error
        })
    }
}

#[cfg(not(windows))]
pub(crate) fn kill_process_tree(pid: u32) -> Result<(), String> {
    let pid = pid.to_string();
    let status = Command::new("kill")
        .args(["-TERM", &pid])
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("kill failed with status {status}"))
    }
}

fn read_process_stream<R: std::io::Read>(
    app: tauri::AppHandle,
    run_key: String,
    project_path: String,
    stream: &str,
    reader: R,
) -> String {
    let mut out = String::new();
    let mut reader = BufReader::new(reader);
    loop {
        let mut bytes = Vec::new();
        match reader.read_until(b'\n', &mut bytes) {
            Ok(0) => break,
            Ok(_) => {
                let line = clean_process_output(&decode_process_bytes(&bytes));
                out.push_str(&line);
                if !line.ends_with('\n') {
                    out.push('\n');
                }
                append_hbuilderx_run_output(&run_key, stream, &line);
                let _ = app.emit(
                    "hbuilderx-run-log",
                    HBuilderXRunLogEvent {
                        project_path: project_path.clone(),
                        stream: stream.to_string(),
                        line,
                    },
                );
            }
            Err(error) => {
                let line = format!("failed to read {stream}: {error}");
                out.push_str(&line);
                out.push('\n');
                let _ = app.emit(
                    "hbuilderx-run-log",
                    HBuilderXRunLogEvent {
                        project_path: project_path.clone(),
                        stream: stream.to_string(),
                        line,
                    },
                );
                break;
            }
        }
    }
    out
}

fn append_hbuilderx_run_output(run_key: &str, stream: &str, line: &str) {
    if let Some(run) = HBUILDERX_WEB_RUNS.lock().unwrap().get_mut(run_key) {
        if stream == "stderr" {
            run.stderr.push_str(line);
        } else {
            run.stdout.push_str(line);
        }
    }
}

pub(crate) fn decode_process_bytes(bytes: &[u8]) -> String {
    match String::from_utf8(bytes.to_vec()) {
        Ok(value) => value,
        Err(_) => {
            let (value, _, _) = encoding_rs::GBK.decode(bytes);
            value.to_string()
        }
    }
}

fn clean_process_output(value: &str) -> String {
    value.to_string()
}

fn display_command(program: &str, args: &[String]) -> String {
    std::iter::once(quote_command_part(program))
        .chain(args.iter().map(|arg| quote_command_part(arg)))
        .collect::<Vec<_>>()
        .join(" ")
}

fn quote_command_part(value: &str) -> String {
    if value.is_empty() {
        return "\"\"".into();
    }
    if value
        .chars()
        .any(|ch| ch.is_whitespace() || matches!(ch, '"' | '\'' | '&' | '|' | '<' | '>' | '^'))
    {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

pub(crate) fn path_to_display_string(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();
    if cfg!(windows) {
        if let Some(stripped) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{stripped}");
        }
        if let Some(stripped) = value.strip_prefix(r"\\?\") {
            return stripped.to_string();
        }
    }
    value
}

fn resolve_workspace_path(root: &str, relative_path: &str) -> Result<(PathBuf, PathBuf), String> {
    let root_path = fs::canonicalize(normalize_input_path(root)).map_err(|e| e.to_string())?;
    if !root_path.is_dir() {
        return Err(format!(
            "workspace root is not a directory: {}",
            root_path.to_string_lossy()
        ));
    }
    let relative = relative_path.trim().replace('\\', "/");
    let relative_path = PathBuf::from(&relative);
    if relative_path.is_absolute() {
        return Err("workspace relative path must not be absolute".into());
    }
    let target = if relative.is_empty() {
        root_path.clone()
    } else {
        root_path.join(relative_path)
    };
    let target = fs::canonicalize(&target).map_err(|e| e.to_string())?;
    if !target.starts_with(&root_path) {
        return Err("workspace path escapes root".into());
    }
    Ok((root_path, target))
}

fn workspace_window_label(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    let hash = hasher.finish();
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("workspace-{hash:x}-{millis}")
}

fn encode_uri_component(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_open_method_prefers_configured_ready_method() {
        let mut settings = Settings::default();
        settings.default_open_method_id = "cursor".into();
        settings
            .open_methods
            .iter_mut()
            .find(|method| method.id == "cursor")
            .unwrap()
            .command = "cursor".into();

        let method = resolve_primary_open_method(&settings).unwrap();
        assert_eq!(method.id, "cursor");
    }

    #[test]
    fn default_open_method_falls_back_when_preference_is_unavailable() {
        let mut settings = Settings::default();
        settings.default_open_method_id = "cursor".into();
        settings
            .open_methods
            .iter_mut()
            .find(|method| method.id == "explorer")
            .unwrap()
            .enabled = false;
        settings
            .open_methods
            .iter_mut()
            .find(|method| method.id == "cursor")
            .unwrap()
            .command
            .clear();

        let method = resolve_primary_open_method(&settings).unwrap();
        assert_eq!(method.id, "workspace");
    }

    #[test]
    fn default_open_method_returns_none_when_no_method_is_ready() {
        let mut settings = Settings::default();
        for method in &mut settings.open_methods {
            method.enabled = false;
        }

        assert!(resolve_primary_open_method(&settings).is_none());
    }

    #[test]
    fn normalize_ai_config_tools_trims_and_normalizes_entries() {
        let path = if cfg!(windows) {
            r"C:/Users/test/.claude".to_string()
        } else {
            "/Users/test/.claude".to_string()
        };
        let tools = normalize_ai_config_tools(vec![AiConfigTool {
            id: " claude ".into(),
            name: " Claude ".into(),
            config_dir: format!(" {path} "),
        }])
        .unwrap();
        assert_eq!(tools[0].id, "claude");
        assert_eq!(tools[0].name, "Claude");
        assert_eq!(tools[0].config_dir, normalize_input_path(&path));
    }

    #[test]
    fn normalize_ai_config_tools_rejects_duplicate_ids() {
        let path = if cfg!(windows) {
            r"C:\Users\test\.claude"
        } else {
            "/Users/test/.claude"
        };
        let tools = vec![
            AiConfigTool {
                id: "same".into(),
                name: "One".into(),
                config_dir: path.into(),
            },
            AiConfigTool {
                id: "same".into(),
                name: "Two".into(),
                config_dir: path.into(),
            },
        ];
        assert!(normalize_ai_config_tools(tools)
            .unwrap_err()
            .contains("重复"));
    }

    #[test]
    fn normalize_ai_config_tools_rejects_relative_paths() {
        let error = normalize_ai_config_tools(vec![AiConfigTool {
            id: "custom".into(),
            name: "Custom".into(),
            config_dir: ".config".into(),
        }])
        .unwrap_err();
        assert!(error.contains("绝对路径"));
    }

    #[test]
    fn parse_ai_config_tools_export_rejects_unknown_versions() {
        let error = parse_ai_config_tools_export(r#"{"version":2,"tools":[]}"#).unwrap_err();
        assert!(error.contains("版本"));
    }

    #[test]
    fn merge_ai_config_tools_updates_appends_and_preserves() {
        let mut existing = vec![
            AiConfigTool {
                id: "claude".into(),
                name: "Old Claude".into(),
                config_dir: r"C:\old".into(),
            },
            AiConfigTool {
                id: "keep".into(),
                name: "Keep".into(),
                config_dir: r"C:\keep".into(),
            },
        ];
        merge_ai_config_tools(
            &mut existing,
            vec![
                AiConfigTool {
                    id: "claude".into(),
                    name: "Claude".into(),
                    config_dir: r"C:\new".into(),
                },
                AiConfigTool {
                    id: "codex".into(),
                    name: "Codex".into(),
                    config_dir: r"C:\codex".into(),
                },
            ],
        );
        assert_eq!(existing.len(), 3);
        assert_eq!(existing[0].name, "Claude");
        assert_eq!(existing[1].id, "keep");
        assert_eq!(existing[2].id, "codex");
    }

    #[test]
    fn known_ai_config_files_cover_builtin_tools() {
        for id in [
            "claude",
            "codex",
            "opencode",
            "pi",
            "grok",
            "antigravity-cli",
            "zcode",
        ] {
            let files = known_ai_config_files(id)
                .unwrap_or_else(|| panic!("missing known files for {id}"));
            assert!(!files.is_empty());
        }
        assert!(known_ai_config_files("ai-config-custom").is_none());
    }

    #[test]
    fn collect_ai_config_files_reports_known_files_as_missing() {
        let dir = if cfg!(windows) {
            r"C:\devhub\definitely\missing"
        } else {
            "/devhub/definitely/missing"
        };
        let files = collect_ai_config_files("claude", dir);
        assert!(files.iter().all(|file| file.known));
        assert!(files
            .iter()
            .any(|file| file.name == "settings.json" && !file.exists));
        assert!(files
            .iter()
            .any(|file| file.name == "CLAUDE.md" && !file.exists));
    }

    #[test]
    fn collect_ai_config_files_marks_existing_files() {
        let dir = std::env::temp_dir().join(format!(
            "devhub-ai-config-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(dir.join("skills")).unwrap();
        fs::write(dir.join("settings.json"), "{}").unwrap();
        let files = collect_ai_config_files("pi", &dir.to_string_lossy());
        let by_name = |name: &str| {
            files
                .iter()
                .find(|file| file.name == name)
                .unwrap_or_else(|| panic!("missing file entry {name}"))
        };
        assert!(by_name("settings.json").exists);
        assert!(!by_name("settings.json").is_dir);
        assert!(by_name("skills").exists);
        assert!(by_name("skills").is_dir);
        assert!(!by_name("AGENTS.md").exists);
        assert_eq!(
            by_name("settings.json").path,
            dir.join("settings.json").to_string_lossy().to_string()
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn collect_ai_config_files_lists_custom_tool_directory_contents() {
        let dir = std::env::temp_dir().join(format!(
            "devhub-ai-config-custom-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("my-config.json"), "{}").unwrap();
        let files = collect_ai_config_files("ai-config-custom", &dir.to_string_lossy());
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "my-config.json");
        assert!(files[0].exists);
        assert!(!files[0].known);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn collect_ai_config_files_returns_empty_for_missing_custom_directory() {
        let dir = if cfg!(windows) {
            r"C:\devhub\definitely\missing"
        } else {
            "/devhub/definitely/missing"
        };
        assert!(collect_ai_config_files("ai-config-custom", dir).is_empty());
    }
}
