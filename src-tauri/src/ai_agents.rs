use crate::commands::{
    attach_child_to_managed_job, configure_hidden_process, decode_process_bytes, kill_process_tree,
};
use chrono::Local;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::Emitter;

/// Per-task stored output is capped so a chatty npm install can't grow memory forever.
const MAX_STORED_OUTPUT_CHARS: usize = 256 * 1024;

/// Hard cap for one `npm view <pkg> version` probe so a dead network
/// connection can't block the whole latest-version batch.
const LATEST_VERSION_TIMEOUT_SECS: u64 = 20;

/// Hard cap for environment probes (`node --version`, `npm ls -g --json`) so a
/// hung npm shim, dead network or antivirus stall can't block the caller
/// forever. Generous because npm legitimately starts slowly on some machines.
const PROBE_TIMEOUT_SECS: u64 = 30;

/// Hard cap for script-agent presence probes (`agy --version`, `grok version`)
/// so a hung binary can't stall the whole agent list.
const VERSION_PROBE_TIMEOUT_SECS: u64 = 15;

const NO_NODE_ERROR: &str = "当前电脑没有 Node 环境，请先安装 Node.js 后再管理 AI Agent";

static AGENT_TASKS: Lazy<Mutex<HashMap<String, AiAgentTaskState>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static TASK_SEQ: AtomicU64 = AtomicU64::new(1);

/// Built-in registry of AI agents. `Npm` agents are distributed as npm global
/// packages; `Script` agents ship no npm package and are installed by their
/// vendor's official install script (a PowerShell one-liner on Windows).
struct AiAgentSpec {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    source: AgentSource,
    /// npm package name; empty for script agents.
    npm_package: &'static str,
    /// The executable command the package provides, e.g. `claude`.
    command: &'static str,
    homepage: &'static str,
    /// npm only: extra flags appended to `npm install -g <pkg>` (e.g.
    /// `--ignore-scripts`).
    install_flags: &'static str,
    /// Script only: PowerShell body that installs the vendor's latest release.
    script_install: &'static str,
    /// Script only: PowerShell body that removes the program files. Config
    /// directories managed by the AI 配置管理 page are deliberately kept.
    script_uninstall: &'static str,
    /// Script only: installer's default binary location as a `%ENV%\...`
    /// template. Probed directly so a binary installed moments ago is
    /// detected even though this process's PATH predates the installer.
    script_binary: &'static str,
    /// Script only: arguments that make the binary print its version.
    script_version_args: &'static [&'static str],
    /// Script only: shell command that prints the latest available version;
    /// empty when the vendor exposes no stable version pointer.
    script_latest_probe: &'static str,
}

/// How an agent is distributed. Serialized lowercase into AiAgentStatus.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentSource {
    Npm,
    Script,
}

/// Registry entry for an npm-distributed agent; script fields stay empty.
fn npm_agent(
    id: &'static str,
    name: &'static str,
    description: &'static str,
    npm_package: &'static str,
    command: &'static str,
    homepage: &'static str,
    install_flags: &'static str,
) -> AiAgentSpec {
    AiAgentSpec {
        id,
        name,
        description,
        source: AgentSource::Npm,
        npm_package,
        command,
        homepage,
        install_flags,
        script_install: "",
        script_uninstall: "",
        script_binary: "",
        script_version_args: &[],
        script_latest_probe: "",
    }
}

fn agent_registry() -> Vec<AiAgentSpec> {
    vec![
        npm_agent(
            "claude-code",
            "Claude Code",
            "Anthropic 官方命令行 AI 编程助手，通过 npm 全局安装后使用 claude 命令。",
            "@anthropic-ai/claude-code",
            "claude",
            "https://www.npmjs.com/package/@anthropic-ai/claude-code",
            "",
        ),
        npm_agent(
            "codex",
            "OpenAI Codex CLI",
            "OpenAI 官方命令行编码 Agent，通过 npm 全局安装后使用 codex 命令。",
            "@openai/codex",
            "codex",
            "https://www.npmjs.com/package/@openai/codex",
            "",
        ),
        npm_agent(
            "gemini-cli",
            "Gemini CLI",
            "Google 官方 Gemini 命令行工具，通过 npm 全局安装后使用 gemini 命令。",
            "@google/gemini-cli",
            "gemini",
            "https://www.npmjs.com/package/@google/gemini-cli",
            "",
        ),
        npm_agent(
            "qwen-code",
            "Qwen Code",
            "通义千问命令行 AI 编程助手，通过 npm 全局安装后使用 qwen 命令。",
            "@qwen-code/qwen-code",
            "qwen",
            "https://www.npmjs.com/package/@qwen-code/qwen-code",
            "",
        ),
        npm_agent(
            "opencode",
            "OpenCode",
            "开源命令行 AI 编程助手，通过 npm 全局安装后使用 opencode 命令。",
            "opencode-ai",
            "opencode",
            "https://www.npmjs.com/package/opencode-ai",
            "",
        ),
        npm_agent(
            "pi",
            "Pi",
            "极简可扩展的 AI 编程 Agent（pi.dev），需要 Node.js 22.19+，通过 npm 全局安装后使用 pi 命令。",
            "@earendil-works/pi-coding-agent",
            "pi",
            "https://www.npmjs.com/package/@earendil-works/pi-coding-agent",
            // 官方推荐的 npm 安装方式，跳过依赖生命周期脚本。
            "--ignore-scripts",
        ),
        AiAgentSpec {
            id: "antigravity-cli",
            name: "Antigravity CLI",
            description: "Google 官方 Antigravity 命令行 AI 编程助手，通过官方安装脚本安装后使用 agy 命令，官方支持后台自动更新。",
            source: AgentSource::Script,
            npm_package: "",
            command: "agy",
            homepage: "https://antigravity.google",
            install_flags: "",
            script_install: "irm https://antigravity.google/cli/install.ps1 | iex",
            script_uninstall:
                "Remove-Item $env:LOCALAPPDATA\\agy -Recurse -Force -ErrorAction SilentlyContinue",
            script_binary: "%LOCALAPPDATA%\\agy\\bin\\agy.exe",
            script_version_args: &["--version"],
            // The updater manifest URL is an install.ps1 implementation detail,
            // so latest-version badges rely on the built-in auto-update instead.
            script_latest_probe: "",
        },
        AiAgentSpec {
            id: "grok",
            name: "Grok CLI",
            description: "xAI 官方 Grok 命令行编码 Agent，通过官方安装脚本安装后使用 grok 命令；卸载只移除程序文件并保留 ~/.grok 配置。",
            source: AgentSource::Script,
            npm_package: "",
            command: "grok",
            homepage: "https://docs.x.ai/build/overview",
            install_flags: "",
            script_install: "irm https://x.ai/cli/install.ps1 | iex",
            script_uninstall: "Remove-Item $env:USERPROFILE\\.grok\\bin -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item $env:LOCALAPPDATA\\grok -Recurse -Force -ErrorAction SilentlyContinue",
            script_binary: "%USERPROFILE%\\.grok\\bin\\grok.exe",
            script_version_args: &["version"],
            // The installer itself resolves this pointer to the current stable.
            script_latest_probe: "curl -fsSL https://x.ai/cli/stable",
        },
    ]
}

fn find_agent_spec(agent_id: &str) -> Option<AiAgentSpec> {
    agent_registry()
        .into_iter()
        .find(|spec| spec.id == agent_id)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NodeEnvStatus {
    pub available: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiAgentStatus {
    pub id: String,
    pub name: String,
    pub description: String,
    pub npm_package: String,
    pub command: String,
    pub homepage: String,
    /// Distribution channel of this agent.
    pub source: AgentSource,
    /// Whether presence detection could actually run. False only for npm
    /// agents when the npm global-list probe failed; script agents always
    /// attempt their own probe.
    pub detect_ok: bool,
    /// Whether a latest-version source exists for the update badge.
    pub has_update_check: bool,
    pub installed: bool,
    pub installed_version: Option<String>,
    /// Full npm command shown in the UI and used for install (also updates).
    /// Spawned installs pin the advertised version on top of this form.
    pub install_command: String,
    /// Full npm command shown in the UI and used for uninstall.
    pub uninstall_command: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiAgentLatestVersion {
    pub id: String,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiAgentRunResult {
    pub task_id: String,
    pub agent_id: String,
    pub command: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiAgentTaskState {
    pub task_id: String,
    pub agent_id: String,
    /// "install" | "uninstall"
    pub kind: String,
    pub command: String,
    pub running: bool,
    pub pid: Option<u32>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub success: Option<bool>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiAgentStopResult {
    pub task_id: String,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiAgentLogEvent {
    pub task_id: String,
    pub agent_id: String,
    pub stream: String,
    pub line: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiAgentExitEvent {
    pub task_id: String,
    pub agent_id: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

/// Run a shell command text and capture its output, killing the process tree
/// if it outlives PROBE_TIMEOUT_SECS. Windows resolves `npm` (a .cmd shim)
/// only through cmd.exe, so all npm/node probes go through the shell wrapper
/// like the node services runner.
fn capture_command(command_text: &str) -> Result<(bool, String, String), String> {
    capture_command_with_timeout(command_text, PROBE_TIMEOUT_SECS)
}

fn capture_command_with_timeout(
    command_text: &str,
    timeout_secs: u64,
) -> Result<(bool, String, String), String> {
    let mut command = build_shell_command(command_text);
    capture_spawned_with_timeout(&mut command, command_text, timeout_secs)
}

/// Run an already-built Command and capture its output, killing the process
/// tree if it outlives timeout_secs. `label` describes the command in the
/// timeout error (e.g. the shell command text or the probed binary path).
fn capture_spawned_with_timeout(
    command: &mut Command,
    label: &str,
    timeout_secs: u64,
) -> Result<(bool, String, String), String> {
    configure_hidden_process(command);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| format!("执行命令失败: {e}"))?;

    // Drain both pipes on helper threads so a chatty child can't fill the OS
    // pipe buffer and deadlock while we poll for exit.
    let stdout_reader = spawn_pipe_drainer(child.stdout.take());
    let stderr_reader = spawn_pipe_drainer(child.stderr.take());

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    // cmd.exe wraps npm/node, so the shell must be killed as a
                    // tree; killing only cmd.exe would leave npm running.
                    let _ = kill_process_tree(child.id());
                    let _ = child.wait();
                    return Err(format!(
                        "命令执行超时（{timeout_secs} 秒）: {label}"
                    ));
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(error) => return Err(format!("等待命令失败: {error}")),
        }
    };
    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    Ok((
        status.success(),
        decode_process_bytes(&stdout).trim().to_string(),
        decode_process_bytes(&stderr).trim().to_string(),
    ))
}

fn spawn_pipe_drainer<R: Read + Send + 'static>(
    pipe: Option<R>,
) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut buffer = Vec::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_end(&mut buffer);
        }
        buffer
    })
}

fn build_shell_command(command_text: &str) -> Command {
    #[cfg(windows)]
    {
        // /C must be handed the command text verbatim via raw_arg, mirroring
        // spawn_service_task's quoting notes in node_services.rs.
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("cmd");
        command.arg("/C").raw_arg(command_text);
        command
    }
    #[cfg(not(windows))]
    {
        let mut command = Command::new("sh");
        command.arg("-c").arg(command_text);
        command
    }
}

#[tauri::command(async)]
pub fn ai_agent_check_node() -> NodeEnvStatus {
    match capture_command("node --version") {
        Ok((true, stdout, _)) => NodeEnvStatus {
            available: true,
            version: Some(normalize_node_version(&stdout)),
            error: None,
        },
        Ok((false, stdout, stderr)) => NodeEnvStatus {
            available: false,
            version: None,
            error: Some(if stderr.is_empty() { stdout } else { stderr }),
        },
        Err(error) => NodeEnvStatus {
            available: false,
            version: None,
            error: Some(error),
        },
    }
}

fn normalize_node_version(raw: &str) -> String {
    let trimmed = raw.trim();
    trimmed.strip_prefix('v').unwrap_or(trimmed).to_string()
}

fn npm_global_packages() -> Result<HashMap<String, String>, String> {
    let (_, stdout, stderr) = capture_command("npm ls -g --depth=0 --json")?;
    let detail = if stdout.is_empty() {
        stderr.clone()
    } else {
        stdout.clone()
    };
    let value: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|_| format!("无法解析 npm 全局包列表: {detail}"))?;
    let mut packages = HashMap::new();
    if let Some(dependencies) = value.get("dependencies").and_then(|d| d.as_object()) {
        for (name, info) in dependencies {
            let version = info
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            packages.insert(name.clone(), version);
        }
    }
    Ok(packages)
}

/// The single source of truth for the install/uninstall command of an agent.
/// The UI preview always shows the unpinned form; a spawned npm install passes
/// the version the UI advertised so the pin is visible in the task's command
/// line. Script installers always fetch the vendor's current release, so the
/// advertised version (an npm concept) is intentionally ignored for them.
fn agent_command_text(spec: &AiAgentSpec, kind: &str, version: Option<&str>) -> String {
    if matches!(spec.source, AgentSource::Script) {
        let body = if kind == "uninstall" {
            spec.script_uninstall
        } else {
            spec.script_install
        };
        return wrap_powershell(body);
    }
    match kind {
        "uninstall" => format!("npm uninstall -g {}", spec.npm_package),
        _ => {
            // Pin the advertised version and force metadata revalidation.
            // `npm install -g pkg` resolves `latest` through cached metadata
            // (npm's local cache and registry CDN edges honour max-age=300),
            // so a freshly published release can be missed and the old
            // version silently reinstalled while the badge already shows the
            // new one (`npm view` uses a different cache key than install).
            let target = match sanitize_npm_version(version) {
                Some(version) => format!("{}@{}", spec.npm_package, version),
                None => spec.npm_package.to_string(),
            };
            let mut command = format!("npm install -g {target}");
            let flags = spec.install_flags.trim();
            if !flags.is_empty() {
                command.push(' ');
                command.push_str(flags);
            }
            command.push_str(" --prefer-online");
            command
        }
    }
}

/// Version pins are interpolated into a `cmd /C` command line via raw_arg, so
/// only plain npm version/dist-tag characters are accepted; anything else
/// falls back to an unpinned install.
fn sanitize_npm_version(version: Option<&str>) -> Option<String> {
    let version = version?.trim();
    let valid = !version.is_empty()
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+'));
    valid.then(|| version.to_string())
}

/// Script agents run vendor PowerShell one-liners through the same shell
/// wrapper as npm. Bodies must not contain double quotes: they would
/// terminate cmd's single quoted argument.
fn wrap_powershell(script_body: &str) -> String {
    format!("powershell -NoProfile -ExecutionPolicy Bypass -Command \"{script_body}\"")
}

/// Detect a script-installed agent by running its documented version command.
/// Any failure — missing binary, non-zero exit, timeout, unparsable output —
/// means "not installed" for listing purposes.
fn probe_script_version(spec: &AiAgentSpec) -> Option<String> {
    // Preferred probe: the installer's default binary location, spawned
    // directly so detection works even though this process's PATH predates
    // the installer's PATH registration (no app restart needed).
    if let Some(binary) = expand_env_template(spec.script_binary) {
        if std::path::Path::new(&binary).exists() {
            let mut command = Command::new(&binary);
            command.args(spec.script_version_args);
            if let Ok((true, stdout, stderr)) = capture_spawned_with_timeout(
                &mut command,
                &binary,
                VERSION_PROBE_TIMEOUT_SECS,
            ) {
                if let Some(version) =
                    extract_version_token(&stdout).or_else(|| extract_version_token(&stderr))
                {
                    return Some(version);
                }
            }
        }
    }
    // Fallback: resolve the bare command through PATH like a user shell would.
    let command_text = format!("{} {}", spec.command, spec.script_version_args.join(" "));
    let Ok((true, stdout, stderr)) =
        capture_command_with_timeout(&command_text, VERSION_PROBE_TIMEOUT_SECS)
    else {
        return None;
    };
    extract_version_token(&stdout).or_else(|| extract_version_token(&stderr))
}

/// Expand a `%VAR%\sub\dir\bin.exe` template; None when a variable is unset
/// (e.g. the Windows-style templates on a non-Windows host).
fn expand_env_template(template: &str) -> Option<String> {
    let mut expanded = String::new();
    for (index, part) in template.split('%').enumerate() {
        if index % 2 == 0 {
            expanded.push_str(part);
        } else {
            expanded.push_str(&std::env::var(part).ok()?);
        }
    }
    Some(expanded)
}

/// Pull the first version-like token (e.g. `1.3.3`) out of free-form output
/// such as `grok version 1.0.52` or a vendor version pointer file.
fn extract_version_token(raw: &str) -> Option<String> {
    let mut run = String::new();
    for ch in raw.chars() {
        if ch.is_ascii_digit() || ch == '.' {
            run.push(ch);
        } else if looks_like_version(&run) {
            return Some(run);
        } else {
            run.clear();
        }
    }
    if looks_like_version(&run) {
        Some(run)
    } else {
        None
    }
}

fn looks_like_version(token: &str) -> bool {
    token.len() >= 3
        && token.starts_with(|c: char| c.is_ascii_digit())
        && token.contains('.')
}

#[tauri::command(async)]
pub fn ai_agent_list() -> Result<Vec<AiAgentStatus>, String> {
    // A missing or broken npm must not hide script-installed agents, so a
    // failed global-list probe degrades to "undetectable" npm rows instead of
    // failing the whole call.
    let (npm_packages, npm_ok) = match npm_global_packages() {
        Ok(packages) => (packages, true),
        Err(_) => (HashMap::new(), false),
    };
    Ok(agent_registry()
        .into_iter()
        .map(|spec| {
            let (installed, installed_version, detect_ok) = match spec.source {
                AgentSource::Npm => {
                    let installed_version = npm_packages.get(spec.npm_package).cloned();
                    (installed_version.is_some(), installed_version, npm_ok)
                }
                AgentSource::Script => {
                    let installed_version = probe_script_version(&spec);
                    (installed_version.is_some(), installed_version, true)
                }
            };
            let has_update_check = match spec.source {
                AgentSource::Npm => true,
                AgentSource::Script => !spec.script_latest_probe.is_empty(),
            };
            AiAgentStatus {
                id: spec.id.to_string(),
                name: spec.name.to_string(),
                description: spec.description.to_string(),
                npm_package: spec.npm_package.to_string(),
                command: spec.command.to_string(),
                homepage: spec.homepage.to_string(),
                source: spec.source,
                detect_ok,
                has_update_check,
                installed,
                installed_version,
                install_command: agent_command_text(&spec, "install", None),
                uninstall_command: agent_command_text(&spec, "uninstall", None),
            }
        })
        .collect())
}

/// Query the npm registry for the latest published version of one package.
/// --prefer-online forces npm to revalidate cached metadata; without it the
/// badge can report a version from a cache populated before the newest
/// release was published.
fn npm_latest_version(npm_package: &str) -> Result<String, String> {
    let command_text = format!("npm view {npm_package} version --prefer-online");
    let (success, stdout, stderr) =
        capture_command_with_timeout(&command_text, LATEST_VERSION_TIMEOUT_SECS)?;
    if !success {
        return Err(if stderr.is_empty() { stdout } else { stderr });
    }
    if stdout.is_empty() {
        return Err("npm 未返回版本号".into());
    }
    Ok(stdout)
}

/// Query a script agent's vendor version pointer (e.g. the stable channel
/// pointer behind the official install script) and extract the version token
/// from whatever it prints.
fn script_latest_version(command_text: &str) -> Result<String, String> {
    let (success, stdout, stderr) =
        capture_command_with_timeout(command_text, LATEST_VERSION_TIMEOUT_SECS)?;
    if !success {
        return Err(if stderr.is_empty() { stdout } else { stderr });
    }
    extract_version_token(&stdout).ok_or_else(|| "无法从输出中解析版本号".into())
}

/// Latest published version per agent, queried in parallel. Each agent reports
/// its own result so one failing/unknown source doesn't hide the others.
/// Script agents without a vendor version pointer report no version at all;
/// the frontend shows their built-in self-update note instead of a badge.
#[tauri::command(async)]
pub fn ai_agent_latest_versions() -> Vec<AiAgentLatestVersion> {
    enum LatestQuery {
        Npm(&'static str),
        Command(&'static str),
        Unsupported,
    }
    let mut handles = Vec::new();
    for spec in agent_registry() {
        let query = match spec.source {
            AgentSource::Npm => LatestQuery::Npm(spec.npm_package),
            AgentSource::Script if !spec.script_latest_probe.is_empty() => {
                LatestQuery::Command(spec.script_latest_probe)
            }
            AgentSource::Script => LatestQuery::Unsupported,
        };
        match query {
            LatestQuery::Npm(npm_package) => handles.push((
                spec.id,
                Some(std::thread::spawn(move || npm_latest_version(npm_package))),
            )),
            LatestQuery::Command(command_text) => handles.push((
                spec.id,
                Some(std::thread::spawn(move || script_latest_version(command_text))),
            )),
            LatestQuery::Unsupported => handles.push((spec.id, None)),
        }
    }
    handles
        .into_iter()
        .map(|(id, handle)| match handle {
            Some(handle) => match handle.join() {
                Ok(Ok(version)) => AiAgentLatestVersion {
                    id: id.to_string(),
                    version: Some(version),
                    error: None,
                },
                Ok(Err(error)) => AiAgentLatestVersion {
                    id: id.to_string(),
                    version: None,
                    error: Some(error),
                },
                Err(_) => AiAgentLatestVersion {
                    id: id.to_string(),
                    version: None,
                    error: Some("查询线程异常退出".into()),
                },
            },
            None => AiAgentLatestVersion {
                id: id.to_string(),
                version: None,
                error: None,
            },
        })
        .collect()
}

#[tauri::command(async)]
pub fn ai_agent_install(
    app: tauri::AppHandle,
    agent_id: String,
    version: Option<String>,
) -> AiAgentRunResult {
    spawn_agent_task(app, &agent_id, "install", version.as_deref())
}

#[tauri::command(async)]
pub fn ai_agent_uninstall(app: tauri::AppHandle, agent_id: String) -> AiAgentRunResult {
    spawn_agent_task(app, &agent_id, "uninstall", None)
}

fn spawn_agent_task(
    app: tauri::AppHandle,
    agent_id: &str,
    kind: &str,
    version: Option<&str>,
) -> AiAgentRunResult {
    let Some(spec) = find_agent_spec(agent_id) else {
        return AiAgentRunResult {
            task_id: String::new(),
            agent_id: agent_id.to_string(),
            command: String::new(),
            error: Some(format!("未知的 AI Agent: {agent_id}")),
        };
    };
    // Script agents install through their vendor script and don't need Node;
    // only npm agents depend on the Node environment.
    if matches!(spec.source, AgentSource::Npm) && !ai_agent_check_node().available {
        return AiAgentRunResult {
            task_id: String::new(),
            agent_id: agent_id.to_string(),
            command: String::new(),
            error: Some(NO_NODE_ERROR.into()),
        };
    }
    let command_text = agent_command_text(&spec, kind, version);
    let task_id = format!(
        "agent-task-{}-{}",
        now_millis(),
        TASK_SEQ.fetch_add(1, Ordering::Relaxed)
    );

    // npm global installs don't need a project cwd; use the home folder so the
    // process still has a valid working directory.
    let work_dir = dirs::home_dir().unwrap_or_else(std::env::temp_dir);

    let mut command = build_shell_command(&command_text);
    command
        .current_dir(&work_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_hidden_process(&mut command);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return AiAgentRunResult {
                task_id,
                agent_id: agent_id.to_string(),
                command: command_text,
                error: Some(format!("启动命令失败: {error}")),
            }
        }
    };
    if let Err(error) = attach_child_to_managed_job(&child) {
        let _ = child.kill();
        let _ = child.wait();
        return AiAgentRunResult {
            task_id,
            agent_id: agent_id.to_string(),
            command: command_text,
            error: Some(error),
        };
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let pid = child.id();
    let state_task_id = task_id.clone();
    let exit_task_id = task_id.clone();
    let exit_agent_id = agent_id.to_string();

    AGENT_TASKS.lock().unwrap().insert(
        task_id.clone(),
        AiAgentTaskState {
            task_id: task_id.clone(),
            agent_id: agent_id.to_string(),
            kind: kind.to_string(),
            command: command_text.clone(),
            running: true,
            pid: Some(pid),
            started_at: now_text(),
            finished_at: None,
            stdout: String::new(),
            stderr: String::new(),
            success: None,
            exit_code: None,
            error: None,
        },
    );

    std::thread::spawn(move || {
        let task_id = state_task_id;
        let stdout_handle = stdout.map(|stream| {
            let app = app.clone();
            let task_id = task_id.clone();
            let agent_id = exit_agent_id.clone();
            std::thread::spawn(move || {
                read_task_stream(app, task_id, agent_id, "stdout", stream)
            })
        });
        let stderr_handle = stderr.map(|stream| {
            let app = app.clone();
            let task_id = task_id.clone();
            let agent_id = exit_agent_id.clone();
            std::thread::spawn(move || {
                read_task_stream(app, task_id, agent_id, "stderr", stream)
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
        if let Some(task) = AGENT_TASKS.lock().unwrap().get_mut(&task_id) {
            task.running = false;
            task.pid = None;
            task.stdout = stdout;
            task.stderr = stderr;
            task.success = Some(success);
            task.exit_code = exit_code;
            task.error = error.clone();
            task.finished_at = Some(now_text());
        }
        let _ = app.emit(
            "ai-agent-exit",
            AiAgentExitEvent {
                task_id: exit_task_id,
                agent_id: exit_agent_id,
                success,
                exit_code,
                error,
            },
        );
    });

    AiAgentRunResult {
        task_id,
        agent_id: agent_id.to_string(),
        command: command_text,
        error: None,
    }
}

#[tauri::command]
pub fn ai_agent_task_list() -> Vec<AiAgentTaskState> {
    let mut tasks: Vec<AiAgentTaskState> =
        AGENT_TASKS.lock().unwrap().values().cloned().collect();
    tasks.sort_by(|a, b| a.started_at.cmp(&b.started_at));
    tasks
}

#[tauri::command(async)]
pub fn ai_agent_task_stop(task_id: String) -> AiAgentStopResult {
    let pid = AGENT_TASKS
        .lock()
        .unwrap()
        .get(&task_id)
        .filter(|task| task.running)
        .and_then(|task| task.pid);
    let Some(pid) = pid else {
        return AiAgentStopResult {
            task_id,
            success: false,
            error: Some("任务不在运行中".into()),
        };
    };
    match kill_process_tree(pid) {
        Ok(()) => AiAgentStopResult {
            task_id,
            success: true,
            error: None,
        },
        Err(error) => AiAgentStopResult {
            task_id,
            success: false,
            error: Some(error),
        },
    }
}

#[tauri::command]
pub fn ai_agent_task_clear(task_id: String) -> Result<(), String> {
    let mut tasks = AGENT_TASKS.lock().unwrap();
    if let Some(task) = tasks.get(&task_id) {
        if task.running {
            return Err("任务还在运行中，无法移除".into());
        }
    }
    tasks.remove(&task_id);
    Ok(())
}

fn read_task_stream<R: std::io::Read>(
    app: tauri::AppHandle,
    task_id: String,
    agent_id: String,
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
                let line = decode_process_bytes(&bytes);
                out.push_str(&line);
                if !line.ends_with('\n') {
                    out.push('\n');
                }
                append_task_output(&task_id, stream, &line);
                let _ = app.emit(
                    "ai-agent-log",
                    AiAgentLogEvent {
                        task_id: task_id.clone(),
                        agent_id: agent_id.clone(),
                        stream: stream.to_string(),
                        line,
                    },
                );
            }
            Err(error) => {
                let line = format!("failed to read {stream}: {error}\n");
                out.push_str(&line);
                append_task_output(&task_id, stream, &line);
                let _ = app.emit(
                    "ai-agent-log",
                    AiAgentLogEvent {
                        task_id: task_id.clone(),
                        agent_id: agent_id.clone(),
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

fn append_task_output(task_id: &str, stream: &str, line: &str) {
    if let Some(task) = AGENT_TASKS.lock().unwrap().get_mut(task_id) {
        let target = if stream == "stderr" {
            &mut task.stderr
        } else {
            &mut task.stdout
        };
        target.push_str(line);
        if target.len() > MAX_STORED_OUTPUT_CHARS {
            let cut = target.len() - MAX_STORED_OUTPUT_CHARS;
            let boundary = (cut..target.len())
                .find(|index| target.is_char_boundary(*index))
                .unwrap_or(target.len());
            target.drain(..boundary);
        }
    }
}

fn now_text() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_command_returns_output() {
        let (success, stdout, stderr) = capture_command("echo hello").unwrap();
        assert!(success);
        assert_eq!(stdout, "hello");
        assert!(stderr.is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn capture_command_kills_hanging_process_tree_on_timeout() {
        // `ping -n 30` stays alive far past the probe timeout unless the whole
        // cmd.exe -> ping tree gets killed.
        let start = std::time::Instant::now();
        let result = capture_command_with_timeout("ping -n 30 127.0.0.1", 2);
        let elapsed = start.elapsed();
        let error = result.unwrap_err();
        assert!(error.contains("超时"), "unexpected error: {error}");
        assert!(
            elapsed < std::time::Duration::from_secs(15),
            "timeout not enforced, took {elapsed:?}"
        );
    }

    #[test]
    fn extract_version_token_parses_common_outputs() {
        assert_eq!(extract_version_token("1.0.52"), Some("1.0.52".into()));
        assert_eq!(
            extract_version_token("grok version 1.0.52 (build abc)\n"),
            Some("1.0.52".into())
        );
        assert_eq!(extract_version_token("v1.3.3"), Some("1.3.3".into()));
        assert_eq!(extract_version_token("no version here"), None);
        assert_eq!(extract_version_token(""), None);
    }

    #[test]
    fn script_agent_commands_are_wrapped_powershell() {
        let grok = find_agent_spec("grok").unwrap();
        // Script installers ignore the npm version pin: they always install
        // the vendor's current release.
        assert_eq!(
            agent_command_text(&grok, "install", Some("1.0.52")),
            agent_command_text(&grok, "install", None)
        );
        let install = agent_command_text(&grok, "install", None);
        assert!(install.starts_with("powershell -NoProfile"), "{install}");
        assert!(install.contains("https://x.ai/cli/install.ps1"), "{install}");
        assert!(
            agent_command_text(&grok, "uninstall", None).contains("Remove-Item"),
            "{}",
            agent_command_text(&grok, "uninstall", None)
        );

        let agy = find_agent_spec("antigravity-cli").unwrap();
        let agy_install = agent_command_text(&agy, "install", None);
        assert!(agy_install.contains("antigravity.google"), "{agy_install}");
    }

    #[test]
    fn script_agents_probe_their_install_location() {
        for id in ["grok", "antigravity-cli"] {
            let spec = find_agent_spec(id).unwrap();
            assert!(matches!(spec.source, AgentSource::Script));
            assert!(spec.script_binary.contains('%'), "{} binary", spec.id);
            assert!(
                !spec.script_version_args.is_empty(),
                "{} version args",
                spec.id
            );
            assert!(!spec.script_install.is_empty(), "{} install", spec.id);
            assert!(!spec.script_uninstall.is_empty(), "{} uninstall", spec.id);
        }
        let claude = find_agent_spec("claude-code").unwrap();
        assert!(matches!(claude.source, AgentSource::Npm));
    }

    #[test]
    fn expand_env_template_resolves_or_rejects() {
        assert_eq!(
            expand_env_template("plain\\path\\agy.exe"),
            Some("plain\\path\\agy.exe".into())
        );
        assert_eq!(
            expand_env_template("%DEVHUB_DEFINITELY_UNSET_VAR%\\agy.exe"),
            None
        );
        #[cfg(windows)]
        {
            let system_root = expand_env_template("%SystemRoot%").unwrap();
            assert!(std::path::Path::new(&system_root).exists());
        }
    }
}
