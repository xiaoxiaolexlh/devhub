use crate::editors::{default_editors, Editor};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

/// Unified app data directory name (matches `identifier` in tauri.conf.json so
/// the NSIS uninstaller's "Delete app data" checkbox cleans up correctly).
pub const APP_DATA_DIR: &str = "com.xiaoxiaol123456.devhub";

/// Temp-directory prefix for the extension trash folder.
pub const APP_TRASH_DIR: &str = "devhub-trash";

/// Current settings.json schema version. Bump when a release must backfill
/// data into files saved by older builds; migrate_settings runs once per bump.
pub const SETTINGS_VERSION: u32 = 1;

/// How a path should be opened from the app.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OpenMethodKind {
    Explorer,
    Workspace,
    ExternalApp,
}

impl Default for OpenMethodKind {
    fn default() -> Self {
        Self::ExternalApp
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct OpenMethod {
    pub id: String,
    pub name: String,
    pub kind: OpenMethodKind,
    pub built_in: bool,
    pub enabled: bool,
    /// Executable path or PATH command name. Only used by `external_app`.
    pub command: String,
    /// Argument template; `{path}` is replaced by the target path. Default `"{path}"`.
    pub args_template: String,
}

impl Default for OpenMethod {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            kind: OpenMethodKind::ExternalApp,
            built_in: false,
            enabled: true,
            command: String::new(),
            args_template: "\"{path}\"".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct AiConfigTool {
    pub id: String,
    pub name: String,
    pub config_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct TerminalProject {
    pub id: String,
    pub name: String,
    pub path: String,
    pub tool_ids: Vec<String>,
}

impl Default for TerminalProject {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            path: String::new(),
            tool_ids: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct TerminalAiTool {
    pub id: String,
    pub name: String,
    pub command: String,
}

impl Default for TerminalAiTool {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            command: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct TerminalEnvVar {
    pub key: String,
    pub value: String,
}

impl Default for TerminalEnvVar {
    fn default() -> Self {
        Self {
            key: String::new(),
            value: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct TerminalEnvGroup {
    pub id: String,
    pub name: String,
    pub variables: Vec<TerminalEnvVar>,
}

impl Default for TerminalEnvGroup {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            variables: Vec::new(),
        }
    }
}

impl Default for AiConfigTool {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            config_dir: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct HBuilderXProject {
    pub id: String,
    pub name: String,
    pub path: String,
    pub run: HBuilderXRunConfig,
    pub publish: HBuilderXPublishConfig,
}

impl Default for HBuilderXProject {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            path: String::new(),
            run: HBuilderXRunConfig::default(),
            publish: HBuilderXPublishConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct HBuilderXProjectGroup {
    pub id: String,
    pub name: String,
    pub project_ids: Vec<String>,
    pub collapsed: bool,
}

impl Default for HBuilderXProjectGroup {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            project_ids: Vec::new(),
            collapsed: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct HBuilderXRunConfig {
    pub web: HBuilderXRunWebConfig,
}

impl Default for HBuilderXRunConfig {
    fn default() -> Self {
        Self {
            web: HBuilderXRunWebConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct HBuilderXRunWebConfig {
    pub browser: String,
    pub ui: bool,
    pub compile: bool,
    pub continue_on_error: bool,
}

impl Default for HBuilderXRunWebConfig {
    fn default() -> Self {
        Self {
            browser: "Built".into(),
            ui: false,
            compile: false,
            continue_on_error: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct HBuilderXPublishConfig {
    pub web: serde_json::Value,
    pub app_resource: HBuilderXPublishAppResourceConfig,
}

impl Default for HBuilderXPublishConfig {
    fn default() -> Self {
        Self {
            web: serde_json::json!({}),
            app_resource: HBuilderXPublishAppResourceConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct HBuilderXPublishAppResourceConfig {
    pub platform: String,
    pub copy_enabled: bool,
    pub copy_source_dir: String,
    pub copy_target_dir: String,
}

impl Default for HBuilderXPublishAppResourceConfig {
    fn default() -> Self {
        Self {
            platform: "APP".into(),
            copy_enabled: false,
            copy_source_dir: String::new(),
            copy_target_dir: String::new(),
        }
    }
}

/// A user-registered launcher pointing at an existing exe on disk.
/// Purely user data (no download/update); opening it focuses the running
/// instance if present, otherwise launches it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct CustomTool {
    pub id: String,
    pub name: String,
    pub exe_path: String,
}

impl Default for CustomTool {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            exe_path: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct NodeService {
    pub id: String,
    pub name: String,
    pub path: String,
    /// Quick commands the user can launch with one click, e.g. `npm run dev`.
    /// Commands run via `cmd /C` in the service folder.
    pub commands: Vec<String>,
}

impl Default for NodeService {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            path: String::new(),
            commands: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Schema version of the saved settings.json. Older files (missing field)
    /// parse as 0 and receive one-time backfills in migrate_settings. Field
    /// level default (0) must win over the struct default (SETTINGS_VERSION)
    /// so pre-versioning files count as un-migrated.
    #[serde(default)]
    pub settings_version: u32,
    pub editors: Vec<Editor>,
    pub source_editor: String,
    /// "skip" | "ask" | "overwrite"
    pub conflict_strategy: String,
    pub backup_days: u32,
    /// "light" | "dark" | "system"
    pub theme: String,
    pub project_config_dirs: Vec<String>,
    pub project_roots: Vec<String>,
    pub hbuilderx_cli_dir: String,
    pub hbuilderx_projects: Vec<HBuilderXProject>,
    pub hbuilderx_project_groups: Vec<HBuilderXProjectGroup>,
    pub ai_config_tools: Vec<AiConfigTool>,
    pub node_services: Vec<NodeService>,
    pub terminal_projects: Vec<TerminalProject>,
    pub terminal_ai_tools: Vec<TerminalAiTool>,
    /// When true, newly launched AI terminals receive the checked env groups.
    pub terminal_env_enabled: bool,
    pub terminal_env_groups: Vec<TerminalEnvGroup>,
    pub terminal_env_active_group_ids: Vec<String>,
    pub open_methods: Vec<OpenMethod>,
    pub default_open_method_id: String,
    /// User-defined exe launchers shown under the "自定义工具" group in the tool manager.
    pub custom_tools: Vec<CustomTool>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            settings_version: SETTINGS_VERSION,
            editors: default_editors(),
            source_editor: "vscode".into(),
            conflict_strategy: "ask".into(),
            backup_days: 7,
            theme: "system".into(),
            project_config_dirs: default_project_config_dirs(),
            project_roots: Vec::new(),
            hbuilderx_cli_dir: String::new(),
            hbuilderx_projects: Vec::new(),
            hbuilderx_project_groups: Vec::new(),
            ai_config_tools: default_ai_config_tools(),
            node_services: Vec::new(),
            terminal_projects: Vec::new(),
            terminal_ai_tools: default_terminal_ai_tools(),
            terminal_env_enabled: false,
            terminal_env_groups: Vec::new(),
            terminal_env_active_group_ids: Vec::new(),
            open_methods: default_open_methods(),
            default_open_method_id: "explorer".into(),
            custom_tools: Vec::new(),
        }
    }
}

pub fn default_open_methods() -> Vec<OpenMethod> {
    let builtin = |id: &str, name: &str, kind: OpenMethodKind| OpenMethod {
        id: id.into(),
        name: name.into(),
        kind,
        built_in: true,
        enabled: true,
        command: String::new(),
        args_template: "\"{path}\"".into(),
    };
    vec![
        builtin("explorer", "资源管理器", OpenMethodKind::Explorer),
        builtin("workspace", "项目内打开", OpenMethodKind::Workspace),
        builtin("vscode", "VS Code", OpenMethodKind::ExternalApp),
        builtin("cursor", "Cursor", OpenMethodKind::ExternalApp),
        builtin("windsurf", "Windsurf", OpenMethodKind::ExternalApp),
        builtin("trae", "Trae", OpenMethodKind::ExternalApp),
    ]
}

fn default_terminal_ai_tools() -> Vec<TerminalAiTool> {
    [
        (
            "codex",
            "Codex",
            "codex --dangerously-bypass-approvals-and-sandbox",
        ),
        (
            "claude-code",
            "Claude Code",
            "claude --dangerously-skip-permissions",
        ),
        ("gemini-cli", "Gemini CLI", "gemini --approval-mode=yolo"),
        ("qwen-code", "Qwen Code", "qwen --approval-mode=yolo"),
        ("opencode", "OpenCode", "opencode --auto"),
        ("aider", "Aider", "aider --yes-always"),
    ]
    .into_iter()
    .map(|(id, name, command)| TerminalAiTool {
        id: id.into(),
        name: name.into(),
        command: command.into(),
    })
    .collect()
}

fn default_ai_config_tools() -> Vec<AiConfigTool> {
    let home = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
    [
        ("claude", "Claude", home.join(".claude")),
        ("codex", "Codex", home.join(".codex")),
        (
            "opencode",
            "OpenCode",
            home.join(".config").join("opencode"),
        ),
        ("pi", "Pi", home.join(".pi").join("agent")),
        ("grok", "Grok", home.join(".grok")),
        // Antigravity CLI (agy) keeps its settings under Gemini's home directory.
        (
            "antigravity-cli",
            "Antigravity CLI",
            home.join(".gemini").join("antigravity-cli"),
        ),
    ]
    .into_iter()
    .map(|(id, name, path)| AiConfigTool {
        id: id.into(),
        name: name.into(),
        config_dir: path.to_string_lossy().to_string(),
    })
    .collect()
}

fn default_project_config_dirs() -> Vec<String> {
    [".vscode", ".windsurf", ".trae", ".cursor"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

pub fn settings_path() -> PathBuf {
    let dir = dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(APP_DATA_DIR);
    let _ = fs::create_dir_all(&dir);
    dir.join("settings.json")
}

/// Migrate user data from legacy directories into the unified app data directory.
///
/// Moves (never overwrites) files from the old `extension-sync` and `run-cleaner`
/// directories so existing users keep their settings after upgrading. Idempotent:
/// once migration succeeds the old dirs are empty/removed and subsequent calls are no-ops.
pub fn migrate_old_data() {
    let data_dir = dirs::data_dir().unwrap_or_else(std::env::temp_dir);
    let new_root = data_dir.join(APP_DATA_DIR);

    // --- extension-sync → <new_root> ---
    let old_root = data_dir.join("extension-sync");
    if old_root.exists() {
        let _ = fs::create_dir_all(&new_root);

        // settings.json
        let old_settings = old_root.join("settings.json");
        let new_settings = new_root.join("settings.json");
        if old_settings.exists() && !new_settings.exists() {
            let _ = fs::rename(&old_settings, &new_settings);
        }

        // tools/ (contains tools.json + <tool_id>/ sub-dirs)
        let old_tools = old_root.join("tools");
        let new_tools = new_root.join("tools");
        if old_tools.exists() && !new_tools.exists() {
            let _ = fs::rename(&old_tools, &new_tools);
        }

        // remove old root if empty
        let _ = fs::remove_dir(&old_root);
    }

    // --- run-cleaner → <new_root>/cleaner ---
    let old_cleaner = data_dir.join("run-cleaner");
    if old_cleaner.exists() {
        let new_cleaner = new_root.join("cleaner");
        let _ = fs::create_dir_all(&new_cleaner);

        let old_config = old_cleaner.join("cleaner.config.json");
        let new_config = new_cleaner.join("cleaner.config.json");
        if old_config.exists() && !new_config.exists() {
            let _ = fs::rename(&old_config, &new_config);
        }

        let _ = fs::remove_dir(&old_cleaner);
    }
}

pub fn load() -> Settings {
    let path = settings_path();
    if !path.exists() {
        return Settings::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
        .map(merge_with_defaults)
        .map(migrate_settings)
        .map(normalize_paths)
        .unwrap_or_default()
}

/// Ensure all four built-in editors are always present even if user wiped settings.json
/// (we never lose the defaults; user-added customs are preserved as well).
fn merge_with_defaults(mut s: Settings) -> Settings {
    let defaults = default_editors();
    for d in defaults {
        if !s.editors.iter().any(|e| e.id == d.id) {
            s.editors.push(d);
        }
    }
    for d in default_open_methods() {
        if !s.open_methods.iter().any(|m| m.id == d.id) {
            s.open_methods.push(d);
        }
    }
    if s.default_open_method_id.trim().is_empty()
        || !s
            .open_methods
            .iter()
            .any(|m| m.id == s.default_open_method_id)
    {
        s.default_open_method_id = "explorer".into();
    }
    if s.project_config_dirs.is_empty() {
        s.project_config_dirs = default_project_config_dirs();
    }
    s
}

/// One-time backfill for settings saved by older builds. When
/// SETTINGS_VERSION is bumped, built-in AI config tools missing from the
/// saved list are appended exactly once; afterwards user deletions stick
/// until the next bump. An explicitly emptied list is respected either way.
fn migrate_settings(mut s: Settings) -> Settings {
    if s.settings_version < SETTINGS_VERSION && !s.ai_config_tools.is_empty() {
        for default in default_ai_config_tools() {
            if !s.ai_config_tools.iter().any(|tool| tool.id == default.id) {
                s.ai_config_tools.push(default);
            }
        }
    }
    s.settings_version = SETTINGS_VERSION;
    s
}

/// Normalize forward slashes to backslashes on Windows so paths persisted
/// from older builds (or hand-edited settings) work correctly with Explorer.
fn normalize_paths(mut s: Settings) -> Settings {
    if cfg!(windows) {
        for e in &mut s.editors {
            e.path = e.path.replace('/', "\\");
        }
        for p in &mut s.project_roots {
            *p = p.replace('/', "\\");
        }
        s.hbuilderx_cli_dir = s.hbuilderx_cli_dir.replace('/', "\\");
        for p in &mut s.hbuilderx_projects {
            p.path = p.path.replace('/', "\\");
            p.publish.app_resource.copy_source_dir =
                p.publish.app_resource.copy_source_dir.replace('/', "\\");
            p.publish.app_resource.copy_target_dir =
                p.publish.app_resource.copy_target_dir.replace('/', "\\");
        }
        for tool in &mut s.ai_config_tools {
            tool.config_dir = tool.config_dir.replace('/', "\\");
        }
        for service in &mut s.node_services {
            service.path = service.path.replace('/', "\\");
        }
        for tool in &mut s.custom_tools {
            tool.exe_path = tool.exe_path.replace('/', "\\");
        }
        for project in &mut s.terminal_projects {
            project.path = project.path.replace('/', "\\");
        }
        for method in &mut s.open_methods {
            if method.kind == OpenMethodKind::ExternalApp && !method.command.is_empty() {
                // Only normalize absolute-looking paths; bare command names stay as-is.
                if method.command.contains('/') || method.command.contains('\\') {
                    method.command = method.command.replace('/', "\\");
                }
            }
        }
    }
    let project_ids: HashSet<String> = s.hbuilderx_projects.iter().map(|p| p.id.clone()).collect();
    let mut assigned = HashSet::new();
    for group in &mut s.hbuilderx_project_groups {
        if group.name.trim().is_empty() {
            group.name = "分组".into();
        }
        group.project_ids.retain(|id| {
            if !project_ids.contains(id) || assigned.contains(id) {
                return false;
            }
            assigned.insert(id.clone());
            true
        });
    }
    s
}

pub fn save(settings: &Settings) -> Result<(), String> {
    let path = settings_path();
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn normalize_open_method_settings(mut settings: Settings) -> Result<Settings, String> {
    let mut ids = HashSet::new();
    for method in &mut settings.open_methods {
        method.id = method.id.trim().to_string();
        method.name = method.name.trim().to_string();
        method.command = method.command.trim().to_string();
        method.args_template = method.args_template.trim().to_string();
        if method.id.is_empty() || method.name.is_empty() {
            return Err("打开方式必须包含 id 和名称".into());
        }
        if !ids.insert(method.id.clone()) {
            return Err(format!("打开方式 ID 重复: {}", method.id));
        }
        if method.kind == OpenMethodKind::ExternalApp && method.args_template.is_empty() {
            method.args_template = "\"{path}\"".into();
        }
        if cfg!(windows)
            && method.kind == OpenMethodKind::ExternalApp
            && (method.command.contains('/') || method.command.contains('\\'))
        {
            method.command = method.command.replace('/', "\\");
        }
    }

    // Built-in kinds must keep their fixed ids/kinds.
    for method in &settings.open_methods {
        if method.id == "explorer" && method.kind != OpenMethodKind::Explorer {
            return Err("内置「资源管理器」类型不可更改".into());
        }
        if method.id == "workspace" && method.kind != OpenMethodKind::Workspace {
            return Err("内置「项目内打开」类型不可更改".into());
        }
    }

    settings.default_open_method_id = settings.default_open_method_id.trim().to_string();
    if settings.default_open_method_id.is_empty()
        || !settings
            .open_methods
            .iter()
            .any(|m| m.id == settings.default_open_method_id)
    {
        settings.default_open_method_id = settings
            .open_methods
            .iter()
            .find(|m| m.id == "explorer")
            .map(|m| m.id.clone())
            .or_else(|| settings.open_methods.first().map(|m| m.id.clone()))
            .unwrap_or_else(|| "explorer".into());
    }
    Ok(settings)
}

/// Render an external-app args template. `{path}` (optionally quoted) becomes one argument.
pub fn render_open_args_template(template: &str, path: &str) -> Vec<String> {
    let template = template.trim();
    if template.is_empty() {
        return vec![path.to_string()];
    }

    const PLACEHOLDER: &str = "\u{FFF0}PATH\u{FFF1}";
    let with_ph = template
        .replace("\"{path}\"", PLACEHOLDER)
        .replace("'{path}'", PLACEHOLDER)
        .replace("{path}", PLACEHOLDER);

    let mut args = Vec::new();
    for part in with_ph.split_whitespace() {
        if part == PLACEHOLDER {
            args.push(path.to_string());
        } else if part.contains(PLACEHOLDER) {
            args.push(part.replace(PLACEHOLDER, path));
        } else {
            let cleaned = part
                .trim_matches('"')
                .trim_matches('\'')
                .to_string();
            if !cleaned.is_empty() {
                args.push(cleaned);
            }
        }
    }
    if args.is_empty() {
        args.push(path.to_string());
    }
    args
}

pub fn normalize_terminal_settings(mut settings: Settings) -> Result<Settings, String> {
    let mut tool_ids = HashSet::new();
    for tool in &mut settings.terminal_ai_tools {
        tool.id = tool.id.trim().to_string();
        tool.name = tool.name.trim().to_string();
        tool.command = tool.command.trim().to_string();
        if tool.id.is_empty() || tool.name.is_empty() {
            return Err("AI 终端工具必须包含 id 和名称".into());
        }
        if tool.command.is_empty() {
            return Err(format!("AI 终端工具“{}”的启动命令不能为空", tool.name));
        }
        if !tool_ids.insert(tool.id.clone()) {
            return Err(format!("AI 终端工具 ID 重复: {}", tool.id));
        }
    }

    let mut project_ids = HashSet::new();
    for project in &mut settings.terminal_projects {
        project.id = project.id.trim().to_string();
        project.name = project.name.trim().to_string();
        project.path = normalize_terminal_path(project.path.trim());
        if project.id.is_empty() || project.name.is_empty() || project.path.is_empty() {
            return Err("AI 终端项目必须包含 id、名称和路径".into());
        }
        if !project_ids.insert(project.id.clone()) {
            return Err(format!("AI 终端项目 ID 重复: {}", project.id));
        }
        if !PathBuf::from(&project.path).is_absolute() {
            return Err(format!("AI 终端项目路径必须是绝对路径: {}", project.path));
        }

        let mut bindings = HashSet::new();
        for tool_id in &mut project.tool_ids {
            *tool_id = tool_id.trim().to_string();
            if !tool_ids.contains(tool_id) {
                return Err(format!(
                    "AI 终端项目“{}”绑定了不存在的工具: {}",
                    project.name, tool_id
                ));
            }
            if !bindings.insert(tool_id.clone()) {
                return Err(format!(
                    "AI 终端项目“{}”重复绑定工具: {}",
                    project.name, tool_id
                ));
            }
        }
    }

    let mut group_ids = HashSet::new();
    for group in &mut settings.terminal_env_groups {
        group.id = group.id.trim().to_string();
        group.name = group.name.trim().to_string();
        if group.id.is_empty() || group.name.is_empty() {
            return Err("临时环境变量组必须包含 id 和名称".into());
        }
        if !group_ids.insert(group.id.clone()) {
            return Err(format!("临时环境变量组 ID 重复: {}", group.id));
        }

        let mut keys = HashSet::new();
        for variable in &mut group.variables {
            variable.key = variable.key.trim().to_string();
            if variable.key.is_empty() {
                return Err(format!("临时环境变量组“{}”包含空的变量名", group.name));
            }
            if !is_env_key(&variable.key) {
                return Err(format!(
                    "临时环境变量名无效: {}。需以字母或下划线开头，只能包含字母、数字和下划线",
                    variable.key
                ));
            }
            if variable
                .value
                .chars()
                .any(|ch| ch == '\n' || ch == '\r' || ch == '\0')
            {
                return Err(format!("临时环境变量“{}”的值不能包含换行", variable.key));
            }
            if !keys.insert(variable.key.to_ascii_uppercase()) {
                return Err(format!(
                    "临时环境变量组“{}”中变量名重复: {}",
                    group.name, variable.key
                ));
            }
        }
    }

    let mut active_ids = Vec::new();
    let mut seen_active = HashSet::new();
    for id in std::mem::take(&mut settings.terminal_env_active_group_ids) {
        let id = id.trim().to_string();
        if id.is_empty() || !group_ids.contains(&id) || !seen_active.insert(id.clone()) {
            continue;
        }
        active_ids.push(id);
    }
    settings.terminal_env_active_group_ids = active_ids;
    Ok(settings)
}

fn is_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(ch) if ch.is_ascii_alphabetic() || ch == '_' => {}
        _ => return false,
    }
    chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

/// Variables injected into a new AI terminal. Later groups override earlier
/// keys, compared case-insensitively. An off switch yields an empty list.
pub fn resolve_terminal_env(settings: &Settings) -> Vec<(String, String)> {
    if !settings.terminal_env_enabled {
        return Vec::new();
    }
    let active: HashSet<&str> = settings
        .terminal_env_active_group_ids
        .iter()
        .map(String::as_str)
        .collect();
    let mut merged = Vec::new();
    let mut index = HashMap::new();
    for group in &settings.terminal_env_groups {
        if !active.contains(group.id.as_str()) {
            continue;
        }
        for variable in &group.variables {
            let lookup = variable.key.to_ascii_uppercase();
            if let Some(position) = index.get(&lookup).copied() {
                merged[position] = (variable.key.clone(), variable.value.clone());
            } else {
                index.insert(lookup, merged.len());
                merged.push((variable.key.clone(), variable.value.clone()));
            }
        }
    }
    merged
}

fn normalize_terminal_path(path: &str) -> String {
    if cfg!(windows) {
        path.replace('/', "\\")
    } else {
        path.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_include_expected_ai_tools() {
        let settings = Settings::default();
        let ids: Vec<&str> = settings
            .ai_config_tools
            .iter()
            .map(|tool| tool.id.as_str())
            .collect();
        assert_eq!(
            ids,
            ["claude", "codex", "opencode", "pi", "grok", "antigravity-cli"]
        );
        assert!(settings
            .ai_config_tools
            .iter()
            .all(|tool| !tool.config_dir.is_empty()));
        assert_eq!(settings.settings_version, SETTINGS_VERSION);
    }

    #[test]
    fn migration_backfills_missing_builtin_ai_tools_once() {
        let saved: Settings = serde_json::from_str(
            r#"{"ai_config_tools":[{"id":"claude","name":"Claude","config_dir":"C:\\Users\\t\\.claude"}]}"#,
        )
        .unwrap();
        assert_eq!(saved.settings_version, 0);
        let migrated = migrate_settings(saved);
        let ids: Vec<&str> = migrated
            .ai_config_tools
            .iter()
            .map(|tool| tool.id.as_str())
            .collect();
        assert!(ids.contains(&"antigravity-cli"));
        assert!(ids.contains(&"grok"));
        assert_eq!(migrated.ai_config_tools[0].id, "claude");
        assert_eq!(migrated.ai_config_tools[0].config_dir, r"C:\Users\t\.claude");
        assert_eq!(migrated.settings_version, SETTINGS_VERSION);

        // Once migrated, a deleted built-in stays deleted until the next bump.
        let mut without_grok = migrated;
        without_grok
            .ai_config_tools
            .retain(|tool| tool.id != "grok");
        let migrated_again = migrate_settings(without_grok);
        assert!(!migrated_again
            .ai_config_tools
            .iter()
            .any(|tool| tool.id == "grok"));
    }

    #[test]
    fn migration_respects_explicitly_emptied_ai_tools() {
        let saved: Settings = serde_json::from_str(r#"{"ai_config_tools":[]}"#).unwrap();
        let migrated = migrate_settings(saved);
        assert!(migrated.ai_config_tools.is_empty());
        assert_eq!(migrated.settings_version, SETTINGS_VERSION);
    }

    #[test]
    fn defaults_include_open_methods() {
        let settings = Settings::default();
        let ids: Vec<&str> = settings
            .open_methods
            .iter()
            .map(|m| m.id.as_str())
            .collect();
        assert_eq!(
            ids,
            ["explorer", "workspace", "vscode", "cursor", "windsurf", "trae"]
        );
        assert_eq!(settings.default_open_method_id, "explorer");
        assert!(settings
            .open_methods
            .iter()
            .filter(|m| m.kind == OpenMethodKind::ExternalApp)
            .all(|m| m.command.is_empty()));
    }

    #[test]
    fn missing_open_methods_are_merged_from_defaults() {
        let settings: Settings = serde_json::from_str("{}").unwrap();
        let merged = merge_with_defaults(settings);
        assert!(merged.open_methods.iter().any(|m| m.id == "explorer"));
        assert!(merged.open_methods.iter().any(|m| m.id == "vscode"));
        assert_eq!(merged.default_open_method_id, "explorer");
    }

    #[test]
    fn render_open_args_template_handles_path_and_flags() {
        let path = r"C:\work\my project";
        assert_eq!(
            render_open_args_template("\"{path}\"", path),
            vec![path.to_string()]
        );
        assert_eq!(
            render_open_args_template("-n \"{path}\"", path),
            vec!["-n".to_string(), path.to_string()]
        );
        assert_eq!(
            render_open_args_template("{path}", path),
            vec![path.to_string()]
        );
    }

    #[test]
    fn explicit_empty_ai_tools_are_not_repopulated() {
        let settings: Settings = serde_json::from_str(r#"{"ai_config_tools":[]}"#).unwrap();
        assert!(settings.ai_config_tools.is_empty());
    }

    #[test]
    fn missing_terminal_fields_receive_defaults_but_explicit_empty_tools_stay_empty() {
        let missing: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(missing.terminal_ai_tools.len(), 6);
        assert!(missing.terminal_projects.is_empty());

        let empty: Settings = serde_json::from_str(r#"{"terminal_ai_tools":[]}"#).unwrap();
        assert!(empty.terminal_ai_tools.is_empty());
    }

    #[test]
    fn normalize_terminal_settings_normalizes_paths_and_rejects_duplicates() {
        let mut settings = Settings::default();
        settings.terminal_projects.push(TerminalProject {
            id: " project ".into(),
            name: " Project ".into(),
            path: if cfg!(windows) {
                "C:/work/中文 项目".into()
            } else {
                "/work/中文 项目".into()
            },
            tool_ids: vec!["codex".into()],
        });
        let normalized = normalize_terminal_settings(settings).unwrap();
        assert_eq!(normalized.terminal_projects[0].id, "project");
        assert_eq!(normalized.terminal_projects[0].name, "Project");
        if cfg!(windows) {
            assert_eq!(normalized.terminal_projects[0].path, r"C:\work\中文 项目");
        }

        let mut duplicate = normalized;
        duplicate
            .terminal_projects
            .push(duplicate.terminal_projects[0].clone());
        assert!(normalize_terminal_settings(duplicate)
            .unwrap_err()
            .contains("重复"));
    }

    #[test]
    fn normalize_terminal_settings_rejects_unknown_bindings_and_empty_commands() {
        let mut settings = Settings::default();
        settings.terminal_projects.push(TerminalProject {
            id: "project".into(),
            name: "Project".into(),
            path: if cfg!(windows) {
                r"C:\work".into()
            } else {
                "/work".into()
            },
            tool_ids: vec!["missing".into()],
        });
        assert!(normalize_terminal_settings(settings)
            .unwrap_err()
            .contains("不存在"));

        let mut settings = Settings::default();
        settings.terminal_ai_tools[0].command = "  ".into();
        assert!(normalize_terminal_settings(settings)
            .unwrap_err()
            .contains("不能为空"));
    }

    #[test]
    fn missing_terminal_env_fields_stay_off_and_empty() {
        let settings: Settings = serde_json::from_str("{}").unwrap();
        assert!(!settings.terminal_env_enabled);
        assert!(settings.terminal_env_groups.is_empty());
        assert!(settings.terminal_env_active_group_ids.is_empty());
    }

    #[test]
    fn normalize_terminal_env_rejects_bad_groups_and_drops_unknown_selection() {
        let mut settings = Settings::default();
        settings.terminal_env_groups.push(TerminalEnvGroup {
            id: " proxy ".into(),
            name: " 代理 ".into(),
            variables: vec![
                TerminalEnvVar {
                    key: " HTTP_PROXY ".into(),
                    value: "http://127.0.0.1:8080".into(),
                },
                TerminalEnvVar {
                    key: "http_proxy".into(),
                    value: "other".into(),
                },
            ],
        });
        assert!(normalize_terminal_settings(settings)
            .unwrap_err()
            .contains("重复"));

        let mut settings = Settings::default();
        settings.terminal_env_groups.push(TerminalEnvGroup {
            id: "proxy".into(),
            name: "代理".into(),
            variables: vec![TerminalEnvVar {
                key: "1PROXY".into(),
                value: "x".into(),
            }],
        });
        assert!(normalize_terminal_settings(settings)
            .unwrap_err()
            .contains("无效"));

        let mut settings = Settings::default();
        settings.terminal_env_enabled = true;
        settings.terminal_env_groups.push(TerminalEnvGroup {
            id: "proxy".into(),
            name: "代理".into(),
            variables: vec![TerminalEnvVar {
                key: "HTTP_PROXY".into(),
                value: "http://127.0.0.1:8080".into(),
            }],
        });
        settings.terminal_env_active_group_ids = vec!["missing".into(), " proxy ".into(), "proxy".into()];
        let normalized = normalize_terminal_settings(settings).unwrap();
        assert_eq!(normalized.terminal_env_groups[0].id, "proxy");
        assert_eq!(normalized.terminal_env_groups[0].variables[0].key, "HTTP_PROXY");
        assert_eq!(normalized.terminal_env_active_group_ids, vec!["proxy".to_string()]);
    }

    #[test]
    fn resolve_terminal_env_merges_checked_groups_and_honors_the_switch() {
        let mut settings = Settings::default();
        settings.terminal_env_groups = vec![
            TerminalEnvGroup {
                id: "base".into(),
                name: "基础".into(),
                variables: vec![
                    TerminalEnvVar {
                        key: "HTTP_PROXY".into(),
                        value: "one".into(),
                    },
                    TerminalEnvVar {
                        key: "TOKEN".into(),
                        value: "base".into(),
                    },
                ],
            },
            TerminalEnvGroup {
                id: "override".into(),
                name: "覆盖".into(),
                variables: vec![TerminalEnvVar {
                    key: "http_proxy".into(),
                    value: "two".into(),
                }],
            },
            TerminalEnvGroup {
                id: "idle".into(),
                name: "未选".into(),
                variables: vec![TerminalEnvVar {
                    key: "TOKEN".into(),
                    value: "ignored".into(),
                }],
            },
        ];
        settings.terminal_env_active_group_ids = vec!["base".into(), "override".into()];
        assert!(resolve_terminal_env(&settings).is_empty());

        settings.terminal_env_enabled = true;
        assert_eq!(
            resolve_terminal_env(&settings),
            vec![
                ("http_proxy".into(), "two".into()),
                ("TOKEN".into(), "base".into()),
            ]
        );
    }

    #[test]
    fn normalize_paths_updates_ai_tool_directories() {
        let mut settings = Settings::default();
        settings.ai_config_tools[0].config_dir = "C:/Users/test/.claude".into();
        let normalized = normalize_paths(settings);
        if cfg!(windows) {
            assert_eq!(
                normalized.ai_config_tools[0].config_dir,
                r"C:\Users\test\.claude"
            );
        }
    }
}
