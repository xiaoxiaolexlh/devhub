use crate::settings::{TerminalAiTool, TerminalProject};
use chrono::{DateTime, Utc};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static TERMINAL_SESSIONS: Lazy<Mutex<Vec<TerminalSession>>> = Lazy::new(|| Mutex::new(Vec::new()));
static TOOL_SEQUENCES: Lazy<Mutex<HashMap<String, u32>>> = Lazy::new(|| Mutex::new(HashMap::new()));
static SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);

const TITLE_PREFIX: &str = "DevHub AI";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TerminalSession {
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub project_path: String,
    pub tool_id: String,
    pub tool_name: String,
    pub tool_sequence: u32,
    pub started_at: DateTime<Utc>,
    pub window_title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalLaunchResult {
    pub session: TerminalSession,
    pub created: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalActionResult {
    pub success: bool,
    pub affected: usize,
    pub error: Option<String>,
}

pub fn list_sessions() -> Vec<TerminalSession> {
    let mut sessions = TERMINAL_SESSIONS.lock().unwrap();
    prune_dead_sessions(&mut sessions);
    sessions.clone()
}

pub fn launch_session(
    project: &TerminalProject,
    tool: &TerminalAiTool,
    force_new: bool,
    env: &[(String, String)],
) -> Result<TerminalLaunchResult, String> {
    if !force_new {
        let existing = {
            let mut sessions = TERMINAL_SESSIONS.lock().unwrap();
            prune_dead_sessions(&mut sessions);
            sessions
                .iter()
                .rev()
                .find(|session| session.project_id == project.id && session.tool_id == tool.id)
                .cloned()
        };
        if let Some(session) = existing {
            focus_window_by_title(&session.window_title)?;
            return Ok(TerminalLaunchResult {
                session,
                created: false,
            });
        }
    }

    let session = create_session(project, tool);
    let command = compose_powershell_launch_command(&tool.command, env);
    // CreateProcess rejects command lines around 32K characters. Leave room for
    // the wt.exe arguments around this PowerShell script.
    if command.len() > 24_000 {
        return Err("临时环境变量过多，启动命令超过 Windows 命令行长度限制".into());
    }
    let args = build_windows_terminal_args(project, &command, &session);
    launch_windows_terminal(&args)?;
    wait_for_window(&session.window_title)?;
    TERMINAL_SESSIONS.lock().unwrap().push(session.clone());
    Ok(TerminalLaunchResult {
        session,
        created: true,
    })
}

pub fn focus_session(session_id: &str) -> TerminalActionResult {
    let session = {
        let mut sessions = TERMINAL_SESSIONS.lock().unwrap();
        prune_dead_sessions(&mut sessions);
        sessions.iter().find(|item| item.id == session_id).cloned()
    };
    let Some(session) = session else {
        return action_error("会话不存在或窗口已关闭");
    };
    match focus_window_by_title(&session.window_title) {
        Ok(()) => action_success(1),
        Err(error) => action_error(error),
    }
}

pub fn close_session(session_id: &str) -> TerminalActionResult {
    let session = TERMINAL_SESSIONS
        .lock()
        .unwrap()
        .iter()
        .find(|item| item.id == session_id)
        .cloned();
    let Some(session) = session else {
        return action_error("会话不存在或窗口已关闭");
    };
    let result = close_window_by_title(&session.window_title);
    match result {
        Ok(()) => {
            remove_session(session_id);
            action_success(1)
        }
        Err(error) => action_error(error),
    }
}

pub fn close_project_sessions(project_id: &str) -> TerminalActionResult {
    close_matching_sessions(|session| session.project_id == project_id)
}

pub fn close_tool_sessions(tool_id: &str) -> TerminalActionResult {
    close_matching_sessions(|session| session.tool_id == tool_id)
}

fn create_session(project: &TerminalProject, tool: &TerminalAiTool) -> TerminalSession {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let counter = SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
    let id = format!("{millis:x}-{counter:x}");
    let tool_sequence = {
        let mut sequences = TOOL_SEQUENCES.lock().unwrap();
        let next = sequences.entry(tool.id.clone()).or_insert(0);
        *next += 1;
        *next
    };
    let window_title = session_window_title(&id);
    TerminalSession {
        id,
        project_id: project.id.clone(),
        project_name: project.name.clone(),
        project_path: project.path.clone(),
        tool_id: tool.id.clone(),
        tool_name: tool.name.clone(),
        tool_sequence,
        started_at: Utc::now(),
        window_title,
    }
}

fn session_window_title(session_id: &str) -> String {
    format!("{TITLE_PREFIX} [{session_id}]")
}

fn terminal_window_name(session_id: &str) -> String {
    format!("devhub-ai-{session_id}")
}

fn build_windows_terminal_args(
    project: &TerminalProject,
    command: &str,
    session: &TerminalSession,
) -> Vec<String> {
    vec![
        "-w".into(),
        terminal_window_name(&session.id),
        "new-tab".into(),
        "--title".into(),
        session.window_title.clone(),
        "--suppressApplicationTitle".into(),
        "--startingDirectory".into(),
        project.path.clone(),
        "powershell.exe".into(),
        "-NoExit".into(),
        "-Command".into(),
        command.to_string(),
    ]
}

/// wt.exe hands the launch to the existing Windows Terminal process, so env
/// vars set on wt.exe itself never reach the shell. Assignments prefixed here
/// exist only inside that PowerShell process.
fn compose_powershell_launch_command(command: &str, env: &[(String, String)]) -> String {
    if env.is_empty() {
        return command.to_string();
    }
    let mut script = String::new();
    for (key, value) in env {
        script.push_str("$env:");
        script.push_str(key);
        script.push_str("='");
        script.push_str(&value.replace('\'', "''"));
        script.push_str("'; ");
    }
    script.push_str(command);
    script
}

fn close_matching_sessions<F>(matches: F) -> TerminalActionResult
where
    F: Fn(&TerminalSession) -> bool,
{
    let targets: Vec<TerminalSession> = TERMINAL_SESSIONS
        .lock()
        .unwrap()
        .iter()
        .filter(|session| matches(session))
        .cloned()
        .collect();
    let mut failures = Vec::new();
    let mut closed_ids = HashSet::new();
    for session in &targets {
        match close_window_by_title(&session.window_title) {
            Ok(()) => {
                closed_ids.insert(session.id.as_str());
            }
            Err(error) => {
                failures.push(format!("{}: {error}", session.project_name));
            }
        }
    }
    TERMINAL_SESSIONS
        .lock()
        .unwrap()
        .retain(|session| !closed_ids.contains(session.id.as_str()));

    if failures.is_empty() {
        action_success(targets.len())
    } else {
        TerminalActionResult {
            success: false,
            affected: closed_ids.len(),
            error: Some(failures.join("\n")),
        }
    }
}

fn prune_dead_sessions(sessions: &mut Vec<TerminalSession>) {
    let titles = enumerate_window_titles();
    prune_sessions_by_titles(sessions, &titles);
}

fn prune_sessions_by_titles(sessions: &mut Vec<TerminalSession>, titles: &HashSet<String>) {
    sessions.retain(|session| {
        titles
            .iter()
            .any(|title| window_title_matches(title, &session.window_title))
    });
}

fn window_title_matches(actual: &str, marker: &str) -> bool {
    actual.contains(marker)
}

fn remove_session(session_id: &str) {
    TERMINAL_SESSIONS
        .lock()
        .unwrap()
        .retain(|session| session.id != session_id);
}

fn action_success(affected: usize) -> TerminalActionResult {
    TerminalActionResult {
        success: true,
        affected,
        error: None,
    }
}

fn action_error(error: impl Into<String>) -> TerminalActionResult {
    TerminalActionResult {
        success: false,
        affected: 0,
        error: Some(error.into()),
    }
}

#[cfg(windows)]
fn launch_windows_terminal(args: &[String]) -> Result<(), String> {
    Command::new("wt.exe")
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "未找到 wt.exe，请先安装或启用 Windows Terminal".into()
            } else {
                format!("启动 Windows Terminal 失败: {error}")
            }
        })
}

#[cfg(not(windows))]
fn launch_windows_terminal(_: &[String]) -> Result<(), String> {
    Err("AI 终端管理仅支持 Windows".into())
}

fn wait_for_window(title: &str) -> Result<(), String> {
    for _ in 0..50 {
        if find_window_by_title(title).is_some() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err(
        "Windows Terminal 已启动，但未能定位会话窗口，请检查 Windows Terminal 版本和窗口标题设置"
            .into(),
    )
}

#[cfg(windows)]
fn enumerate_window_titles() -> HashSet<String> {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextLengthW, GetWindowTextW,
    };

    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let titles = &mut *(lparam as *mut HashSet<String>);
        let length = GetWindowTextLengthW(hwnd);
        if length > 0 {
            let mut buffer = vec![0u16; length as usize + 1];
            let copied = GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
            if copied > 0 {
                titles.insert(String::from_utf16_lossy(&buffer[..copied as usize]));
            }
        }
        1
    }

    let mut titles = HashSet::new();
    unsafe {
        EnumWindows(
            Some(callback),
            &mut titles as *mut HashSet<String> as LPARAM,
        );
    }
    titles
}

#[cfg(not(windows))]
fn enumerate_window_titles() -> HashSet<String> {
    HashSet::new()
}

#[cfg(windows)]
fn find_window_by_title(title: &str) -> Option<windows_sys::Win32::Foundation::HWND> {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextLengthW, GetWindowTextW,
    };

    struct Search<'a> {
        title: &'a str,
        hwnd: HWND,
    }
    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let search = &mut *(lparam as *mut Search<'_>);
        let length = GetWindowTextLengthW(hwnd);
        if length <= 0 {
            return 1;
        }
        let mut buffer = vec![0u16; length as usize + 1];
        let copied = GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
        if copied > 0
            && window_title_matches(
                &String::from_utf16_lossy(&buffer[..copied as usize]),
                search.title,
            )
        {
            search.hwnd = hwnd;
            return 0;
        }
        1
    }

    let mut search = Search {
        title,
        hwnd: std::ptr::null_mut(),
    };
    unsafe {
        EnumWindows(Some(callback), &mut search as *mut Search<'_> as LPARAM);
    }
    (!search.hwnd.is_null()).then_some(search.hwnd)
}

#[cfg(not(windows))]
fn find_window_by_title(_: &str) -> Option<isize> {
    None
}

#[cfg(windows)]
fn focus_window_by_title(title: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };
    let hwnd = find_window_by_title(title).ok_or("未找到对应的 Windows Terminal 窗口")?;
    unsafe {
        ShowWindow(hwnd, SW_RESTORE);
        BringWindowToTop(hwnd);
        if SetForegroundWindow(hwnd) == 0 {
            return Err("Windows 拒绝将 Terminal 切换到前台，请从任务栏手动切换".into());
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn focus_window_by_title(_: &str) -> Result<(), String> {
    Err("AI 终端管理仅支持 Windows".into())
}

#[cfg(windows)]
fn close_window_by_title(title: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_CLOSE};
    let hwnd = find_window_by_title(title).ok_or("未找到对应的 Windows Terminal 窗口")?;
    let sent = unsafe { PostMessageW(hwnd, WM_CLOSE, 0, 0) };
    if sent == 0 {
        Err(format!(
            "发送关闭消息失败: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn close_window_by_title(_: &str) -> Result<(), String> {
    Err("AI 终端管理仅支持 Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_project() -> TerminalProject {
        TerminalProject {
            id: "project".into(),
            name: "中文 Project".into(),
            path: r#"C:\work dir\中文\"quoted\""#.into(),
            tool_ids: vec!["codex".into()],
        }
    }

    fn sample_tool() -> TerminalAiTool {
        TerminalAiTool {
            id: "codex".into(),
            name: "Codex".into(),
            command: r#"codex --flag \"quoted value\""#.into(),
        }
    }

    #[test]
    fn terminal_args_keep_path_and_command_as_separate_arguments() {
        let project = sample_project();
        let tool = sample_tool();
        let session = create_session(&project, &tool);
        let args = build_windows_terminal_args(&project, &tool.command, &session);
        assert_eq!(args[6], "--startingDirectory");
        assert_eq!(args[7], project.path);
        assert_eq!(args[10], "-Command");
        assert_eq!(args[11], tool.command);
        assert!(!args[11].contains(&project.path));
    }

    #[test]
    fn powershell_command_without_env_is_unchanged() {
        assert_eq!(compose_powershell_launch_command("claude", &[]), "claude");
    }

    #[test]
    fn powershell_command_prefixes_escaped_env_assignments() {
        let command = compose_powershell_launch_command(
            r#"codex --flag "quoted""#,
            &[
                ("HTTP_PROXY".into(), "http://127.0.0.1:8080".into()),
                ("TOKEN".into(), "a'b".into()),
            ],
        );
        assert_eq!(
            command,
            "$env:HTTP_PROXY='http://127.0.0.1:8080'; $env:TOKEN='a''b'; codex --flag \"quoted\""
        );
    }

    #[test]
    fn session_titles_are_unique_and_identifiable() {
        let first = session_window_title("one");
        let second = session_window_title("two");
        assert_ne!(first, second);
        assert_eq!(first, "DevHub AI [one]");
        assert!(window_title_matches(
            "DevHub AI [one] - Windows Terminal",
            &first
        ));
    }

    #[test]
    fn pruning_and_batch_filters_only_touch_matching_sessions() {
        let project = sample_project();
        let tool = sample_tool();
        let first = create_session(&project, &tool);
        let mut other_project = project.clone();
        other_project.id = "other".into();
        let second = create_session(&other_project, &tool);
        let mut sessions = vec![first.clone(), second.clone()];
        let titles = HashSet::from([second.window_title.clone()]);
        prune_sessions_by_titles(&mut sessions, &titles);
        assert_eq!(sessions, vec![second.clone()]);
        assert!(sessions.iter().all(|session| session.project_id == "other"));
        assert!(sessions.iter().all(|session| session.tool_id == "codex"));
    }
}
