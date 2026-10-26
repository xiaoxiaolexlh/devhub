//! Windows 11 Explorer integration is opt-in; startup never registers a package.
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize, serde::Deserialize)]
pub struct ExplorerMenuStatus {
    supported: bool,
    available: bool,
    installed: bool,
}

#[tauri::command]
pub async fn explorer_menu_status(app: tauri::AppHandle) -> Result<ExplorerMenuStatus, String> {
    run(app, "status").await
}

#[tauri::command]
pub async fn explorer_menu_set_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<ExplorerMenuStatus, String> {
    run(app, if enabled { "install" } else { "uninstall" }).await
}

async fn run(app: tauri::AppHandle, action: &'static str) -> Result<ExplorerMenuStatus, String> {
    tauri::async_runtime::spawn_blocking(move || run_sync(&app, action))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(windows)]
fn run_sync(app: &tauri::AppHandle, action: &str) -> Result<ExplorerMenuStatus, String> {
    use std::os::windows::process::CommandExt;
    let script = app
        .path()
        .resolve(
            "resources/explorer/manage.ps1",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|error| error.to_string())?;
    if !script.is_file() {
        return Err("缺少右键菜单组件，请重新构建或安装 DevHub。".into());
    }
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let directory = executable.parent().ok_or("无法确定 DevHub 所在目录")?;
    let powershell = std::path::PathBuf::from(
        std::env::var_os("SystemRoot").ok_or("无法确定 Windows 系统目录")?,
    )
    .join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let output = std::process::Command::new(powershell)
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(script)
        .args(["-Action", action, "-AppDirectory"])
        .arg(directory)
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
        .map_err(|error| format!("无法运行右键菜单配置：{error}"))?;
    if !output.status.success() {
        return Err(format!(
            "右键菜单配置失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|error| format!("无法读取右键菜单状态：{error}"))
}

#[cfg(not(windows))]
fn run_sync(_app: &tauri::AppHandle, _action: &str) -> Result<ExplorerMenuStatus, String> {
    Ok(ExplorerMenuStatus {
        supported: false,
        available: false,
        installed: false,
    })
}
