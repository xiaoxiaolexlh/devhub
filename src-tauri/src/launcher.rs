use crate::{
    commands,
    hotkey::{BackgroundHotkey, HotkeyService, Shortcut},
    settings::LauncherSettings,
    tools,
};
use serde::Serialize;
use std::{path::Path, sync::Mutex};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const WINDOW: &str = "launcher";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherStatus {
    pub registered: bool,
    pub error: Option<String>,
    pub tray_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Navigation {
    pub mode: String,
    pub tool_id: Option<String>,
}

pub struct LauncherRuntime {
    hotkey: HotkeyService,
    background_escape: BackgroundHotkey,
    status: Mutex<LauncherStatus>,
    navigation: Mutex<Option<Navigation>>,
}

pub fn setup(app: &tauri::AppHandle, settings: &LauncherSettings) -> Result<(), String> {
    let callback_app = app.clone();
    let hotkey = HotkeyService::new(move || {
        let app = callback_app.clone();
        let main_thread = app.clone();
        let _ = main_thread.run_on_main_thread(move || {
            if let Err(error) = toggle(&app) {
                eprintln!("快捷面板打开失败: {error}");
            }
        });
    })?;
    let escape_app = app.clone();
    let background_escape = BackgroundHotkey::new(Shortcut::ESCAPE, move || {
        let app = escape_app.clone();
        let main_thread = app.clone();
        let _ = main_thread.run_on_main_thread(move || {
            // A queued hotkey must not dismiss a window that has regained focus.
            if let Some(window) = app.get_webview_window(WINDOW) {
                if window.is_visible().unwrap_or(false) && !window.is_focused().unwrap_or(true) {
                    if let Err(error) = hide(&app) {
                        eprintln!("快捷面板收起失败: {error}");
                    }
                }
            }
        });
    })?;
    let registration = if settings.enabled {
        Shortcut::parse(&settings.shortcut).and_then(|key| hotkey.configure(Some(key)))
    } else {
        Ok(())
    };
    let tray_available = setup_tray(app)
        .map_err(|e| eprintln!("托盘创建失败: {e}"))
        .is_ok();
    app.manage(LauncherRuntime {
        hotkey,
        background_escape,
        status: Mutex::new(LauncherStatus {
            registered: settings.enabled && registration.is_ok(),
            error: registration.err(),
            tray_available,
        }),
        navigation: Mutex::new(None),
    });
    let window =
        WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("index.html?launcher".into()))
            .title("DevHub 快捷面板")
            .inner_size(760.0, 560.0)
            .resizable(false)
            .decorations(false)
            .visible(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .center()
            .background_color(tauri::window::Color(15, 23, 42, 255))
            .build()
            .map_err(|e| e.to_string())?;
    let _ = window.set_background_color(Some(crate::window_bg_color(
        &window,
        &commands::get_settings().theme,
    )));
    Ok(())
}

fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };
    let open = MenuItem::with_id(app, "main", "打开 DevHub", true, None::<&str>)?;
    let launcher = MenuItem::with_id(app, "launcher", "快捷面板", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "退出 DevHub", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &launcher, &exit])?;
    let mut builder = TrayIconBuilder::with_id("devhub")
        .tooltip("DevHub · 快捷面板")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let result = match event.id.as_ref() {
                "main" => show_main(app).map(|_| ()),
                "launcher" => toggle(app),
                "exit" => request_exit(app),
                _ => Ok(()),
            };
            if let Err(error) = result {
                eprintln!("托盘操作失败: {error}");
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                let _ = show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

pub fn show_main(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    let window = if let Some(window) = app.get_webview_window("main") {
        window
    } else {
        let config = app
            .config()
            .app
            .windows
            .iter()
            .find(|window| window.label == "main")
            .ok_or("主窗口配置不存在")?;
        let window = WebviewWindowBuilder::from_config(app, config)
            .map_err(|e| e.to_string())?
            .build()
            .map_err(|e| e.to_string())?;
        let _ = window.set_background_color(Some(crate::window_bg_color(
            &window,
            &commands::get_settings().theme,
        )));
        window
    };
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(window)
}

fn toggle(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window(WINDOW).ok_or("快捷面板尚未就绪")?;
    if window.is_visible().map_err(|e| e.to_string())? {
        return hide(app);
    }
    // Position on the monitor containing the cursor; retain logical sizing on mixed-DPI displays.
    if let Ok(cursor) = app.cursor_position() {
        if let Ok(Some(monitor)) = app.monitor_from_point(cursor.x, cursor.y) {
            let scale = monitor.scale_factor();
            let area = monitor.work_area();
            let origin = &area.position;
            let size = &area.size;
            let width = (760.0 * scale).min(size.width as f64);
            let height = (560.0 * scale).min(size.height as f64);
            let _ = window.set_size(tauri::PhysicalSize::new(width as u32, height as u32));
            let _ = window.set_position(tauri::PhysicalPosition::new(
                origin.x + ((size.width as f64 - width) / 2.0) as i32,
                origin.y + ((size.height as f64 - height) / 3.0) as i32,
            ));
        }
    }
    window
        .emit("devhub:launcher-shown", ())
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    let focused = window.set_focus().map_err(|e| e.to_string());
    // Cover a show operation where Windows declines foreground activation.
    sync_background_escape(app)?;
    focused
}

pub fn sync_background_escape(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window(WINDOW).ok_or("快捷面板不存在")?;
    app.state::<LauncherRuntime>()
        .background_escape
        .sync_window(
            window.is_visible().map_err(|e| e.to_string())?,
            window.is_focused().map_err(|e| e.to_string())?,
        )
}

pub fn save_settings_transaction(
    app: &tauri::AppHandle,
    settings: &LauncherSettings,
    persist: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let runtime = app.state::<LauncherRuntime>();
    let key = if settings.enabled {
        Some(Shortcut::parse(&settings.shortcut)?)
    } else {
        None
    };
    runtime.hotkey.configure_with(key, persist)?;
    let mut status = runtime.status.lock().map_err(|e| e.to_string())?;
    status.registered = settings.enabled;
    status.error = None;
    Ok(())
}

fn request_exit(app: &tauri::AppHandle) -> Result<(), String> {
    let window = show_main(app)?;
    // Pending state also covers a main window which is still loading its bundle.
    app.state::<LauncherRuntime>()
        .navigation
        .lock()
        .map_err(|e| e.to_string())?
        .replace(Navigation {
            mode: "exit".into(),
            tool_id: None,
        });
    window
        .emit("devhub:navigate", ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn launcher_status(app: tauri::AppHandle) -> LauncherStatus {
    app.state::<LauncherRuntime>()
        .status
        .lock()
        .unwrap()
        .clone()
}

#[tauri::command]
pub fn launcher_toggle(app: tauri::AppHandle) -> Result<(), String> {
    toggle(&app)
}

#[tauri::command]
pub fn launcher_hide(app: tauri::AppHandle) -> Result<(), String> {
    hide(&app)
}

pub fn hide(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window(WINDOW).ok_or("快捷面板不存在")?;
    window.hide().map_err(|e| e.to_string())?;
    app.state::<LauncherRuntime>()
        .background_escape
        .sync_window(false, false)?;
    window
        .emit("devhub:launcher-hidden", ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn launcher_hide_main(app: tauri::AppHandle) -> Result<(), String> {
    if !app
        .state::<LauncherRuntime>()
        .status
        .lock()
        .unwrap()
        .tray_available
    {
        return Err("托盘不可用，无法隐藏主窗口".into());
    }
    app.get_webview_window("main")
        .ok_or("主窗口不存在")?
        .hide()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn launcher_exit(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn launcher_open_mode(
    app: tauri::AppHandle,
    mode: String,
    tool_id: Option<String>,
) -> Result<(), String> {
    if !matches!(
        mode.as_str(),
        "home"
            | "extensions"
            | "project-configs"
            | "hbuilderx-cli"
            | "node-services"
            | "directory-cleaner"
            | "ai-configs"
            | "ai-agents"
            | "terminal-manager"
            | "tool-manager"
            | "system-settings"
            | "settings"
    ) {
        return Err("未知的工作台模式".into());
    }
    app.state::<LauncherRuntime>()
        .navigation
        .lock()
        .map_err(|e| e.to_string())?
        .replace(Navigation { mode, tool_id });
    let window = show_main(&app)?;
    window
        .emit("devhub:navigate", ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn launcher_take_navigation(app: tauri::AppHandle) -> Option<Navigation> {
    app.state::<LauncherRuntime>()
        .navigation
        .lock()
        .unwrap()
        .take()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogTool {
    id: String,
    name: String,
    description: String,
    group_name: String,
    exe_path: String,
    kind: &'static str,
    available: bool,
    status: &'static str,
}

#[tauri::command]
pub async fn launcher_catalog() -> Result<Vec<CatalogTool>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut entries: Vec<_> = tools::tool_list()?
            .into_iter()
            .map(|tool| {
                let available =
                    !tool.manual_download && tool.installed && Path::new(&tool.exe_path).is_file();
                CatalogTool {
                    id: tool.id,
                    name: tool.name,
                    description: tool.description,
                    group_name: tool.group_name,
                    exe_path: tool.exe_path,
                    kind: "tool",
                    available,
                    status: if tool.manual_download {
                        "官网下载"
                    } else if !tool.installed {
                        "未安装"
                    } else if !available {
                        "路径失效"
                    } else {
                        "打开工具"
                    },
                }
            })
            .collect();
        entries.extend(
            commands::get_settings()
                .custom_tools
                .into_iter()
                .map(|tool| {
                    let available = Path::new(&tool.exe_path).is_file();
                    CatalogTool {
                        id: tool.id,
                        name: tool.name,
                        description: tool.exe_path.clone(),
                        group_name: "自定义工具".into(),
                        exe_path: tool.exe_path,
                        kind: "custom",
                        available,
                        status: if available {
                            "打开工具"
                        } else {
                            "路径失效"
                        },
                    }
                }),
        );
        Ok(entries)
    })
    .await
    .map_err(|e| e.to_string())?
}
