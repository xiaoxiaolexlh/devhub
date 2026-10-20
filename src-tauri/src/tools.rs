use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

use crate::settings::APP_DATA_DIR;

// ===== 内置工具注册表 =====

/// 如何解析远端最新版本。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VersionSource {
    /// `update_url` 为 geek 管道格式: build|version|changelog...
    UpdateTxt,
    /// 对 `download_url` 发请求,从 302 Location / 最终 URL 文件名解析版本。
    RedirectFilename,
    /// `update_url` 为发布清单 JSON(GoNavi assets[] / DBX Tauri platforms);
    /// `download_url` 为资源名后缀、`{version}` URL 模板,或 platforms 键名。
    LatestJson,
    /// `update_url` 为 `KEY=VALUE` 文本(WizTree 官方版本接口),取 `VERSION=`;
    /// `download_url` 为含 `{version_underscore}` 的 URL 模板(4.32 → 4_32)。
    /// 下载地址依赖版本号,主源不可用时回退扫描 `fallback_page_url`。
    KeyValueTxt,
    /// `update_url` 为发布入口(如 GitHub `releases/latest`),302 到 `.../releases/tag/<tag>`,
    /// 从 tag 提取版本;`download_url` 为含 `{version}` 的 URL 模板。
    /// 下载地址依赖版本号,入口不可达时必须中断。
    RedirectTag,
}

/// 工具分组注册表,写死在代码中。元组为 `(分组 id, 分组显示名)`,顺序即前端标签栏顺序。
/// 新增工具时:先判断能否归入已有分组,能则复用其 id;都不合适再在此处追加新分组,
/// 并把 ToolSpec.group 设为该新 id。
const TOOL_GROUPS: &[(&str, &str)] = &[
    ("system", "系统工具"),
    ("database", "数据库工具"),
    ("ai", "AI 工具"),
    ("editor", "文本编辑器"),
];

/// 查分组显示名;未登记的 id 原样返回,避免前端渲染空白。
fn group_display_name(id: &str) -> String {
    TOOL_GROUPS
        .iter()
        .find(|(gid, _)| *gid == id)
        .map(|(_, name)| (*name).to_string())
        .unwrap_or_else(|| id.to_string())
}

#[derive(Debug, Clone)]
struct ToolSpec {
    id: String,
    name: String,
    /// 工具分组 id,必须取自 TOOL_GROUPS;新增工具优先归入已有分组,都不合适再新建分组。
    group: String,
    description: String,
    download_url: String,
    /// UpdateTxt / LatestJson / KeyValueTxt 时使用;RedirectFilename 时可空。
    update_url: String,
    /// KeyValueTxt 主源不可用时,从该页面 HTML 扫描下载文件名兜底;其它源留空。
    fallback_page_url: String,
    version_source: VersionSource,
    exe_entry: String,
    /// 与 exe 一并解压的附属文件(如 Everything.lng)。
    /// 含 `/` 的条目按相对路径落地(如 WizTree 的 locale/<lang>/LC_MESSAGES/default.mo)。
    extra_entries: Vec<String>,
    /// true 时整包解压到工具目录(自动剥离唯一顶层目录),适用于带运行库/插件/主题的完整应用;
    /// false 时只解压 exe_entry + extra_entries。
    extract_all: bool,
    /// true 时下载的是裸 exe(非 zip),直接放入工具目录不经过解压。
    raw_exe: bool,
    homepage: String,
}

fn registry() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            id: "geek".into(),
            name: "Geek Uninstaller".into(),
            group: "system".into(),
            description: "便携版,下载后存放在本应用数据目录,双击卡片即可打开。".into(),
            download_url: "https://geekuninstaller.com/geek.zip".into(),
            update_url: "https://geekuninstaller.com/update.txt".into(),
            fallback_page_url: String::new(),
            version_source: VersionSource::UpdateTxt,
            exe_entry: "geek.exe".into(),
            extra_entries: vec![],
            extract_all: false,
            raw_exe: false,
            homepage: "https://geekuninstaller.com".into(),
        },
        ToolSpec {
            id: "everything".into(),
            name: "Everything".into(),
            group: "system".into(),
            description: "1.4 稳定便携版(x64 多语言),下载后存放在本应用数据目录,双击卡片即可打开。"
                .into(),
            // 无版本号入口,302 到当前稳定 x64 多语言便携包,例如 Everything-1.4.1.1032.x64.zip
            download_url: "https://www.voidtools.com/Everything.x64.zip".into(),
            update_url: String::new(),
            fallback_page_url: String::new(),
            version_source: VersionSource::RedirectFilename,
            exe_entry: "Everything.exe".into(),
            extra_entries: vec!["Everything.lng".into()],
            extract_all: false,
            raw_exe: false,
            homepage: "https://www.voidtools.com/zh-cn/".into(),
        },
        ToolSpec {
            id: "gonavi".into(),
            name: "GoNavi".into(),
            group: "database".into(),
            description: "高性能多数据源数据库客户端(约 30MB 级,Wails),Windows x64 便携版,下载后存放在本应用数据目录。"
                .into(),
            // LatestJson: release asset 名后缀,匹配 assets[]
            download_url: "Windows-Amd64-Portable.zip".into(),
            update_url: "https://github.com/Syngnat/GoNavi/releases/latest/download/latest.json"
                .into(),
            fallback_page_url: String::new(),
            version_source: VersionSource::LatestJson,
            exe_entry: "GoNavi.exe".into(),
            extra_entries: vec![],
            extract_all: false,
            raw_exe: false,
            homepage: "https://gonavi.org".into(),
        },
        ToolSpec {
            id: "dbx".into(),
            name: "DBX".into(),
            group: "database".into(),
            description: "约 20MB 轻量跨平台数据库客户端(90+ 数据源,内置 AI/MCP),Windows x64 便携版,下载后存放在本应用数据目录。"
                .into(),
            // LatestJson: 版本来自 Tauri latest.json,下载地址用 {version} 展开便携 zip
            // (platforms.windows-x86_64 指向 msi,便携包需按文件名拼装)
            download_url:
                "https://github.com/t8y2/dbx/releases/download/v{version}/DBX_{version}_x64-portable.zip"
                    .into(),
            update_url: "https://github.com/t8y2/dbx/releases/latest/download/latest.json".into(),
            fallback_page_url: String::new(),
            version_source: VersionSource::LatestJson,
            exe_entry: "DBX.exe".into(),
            // 空标记文件,告知 DBX 以便携模式运行
            extra_entries: vec!["portable.dbx".into()],
            extract_all: false,
            raw_exe: false,
            homepage: "https://dbxio.com".into(),
        },
        ToolSpec {
            id: "wiztree".into(),
            name: "WizTree".into(),
            group: "system".into(),
            description: "极速磁盘空间分析(直接读取 NTFS 索引),x64 便携版(带中文界面),下载后存放在本应用数据目录。"
                .into(),
            // KeyValueTxt: 官网只提供带版本号的便携包链接,版本从官方版本接口取,
            // 再按 4.32 → 4_32 拼装文件名
            download_url: "https://diskanalyzer.com/files/wiztree_{version_underscore}_portable.zip"
                .into(),
            update_url: "https://antibody-software.com/files/wiztreeversion.php".into(),
            fallback_page_url: "https://diskanalyzer.com/download".into(),
            version_source: VersionSource::KeyValueTxt,
            exe_entry: "WizTree64.exe".into(),
            // 语言包需保留相对路径,落地到 exe 同级 locale\<lang>\LC_MESSAGES\
            extra_entries: vec![
                "locale/zh_CHS/LC_MESSAGES/default.mo".into(),
                "locale/zh_CHT/LC_MESSAGES/default.mo".into(),
                "locale/en/LC_MESSAGES/default.mo".into(),
                "license.txt".into(),
            ],
            extract_all: false,
            raw_exe: false,
            homepage: "https://diskanalyzer.com".into(),
        },
        ToolSpec {
            id: "cc-switch".into(),
            name: "CC Switch".into(),
            group: "ai".into(),
            description: "Claude Code / Codex 等 AI CLI 的供应商与配置切换工具,Tauri 桌面应用,Windows x64 便携版,下载后存放在本应用数据目录。"
                .into(),
            // LatestJson: 版本来自 Tauri latest.json,下载地址用 {version} 展开便携 zip
            // (platforms.windows-x86_64 指向 msi,便携包需按文件名拼装)
            download_url:
                "https://github.com/farion1231/cc-switch/releases/download/v{version}/CC-Switch-v{version}-Windows-Portable.zip"
                    .into(),
            update_url: "https://github.com/farion1231/cc-switch/releases/latest/download/latest.json"
                .into(),
            fallback_page_url: String::new(),
            version_source: VersionSource::LatestJson,
            exe_entry: "cc-switch.exe".into(),
            // 空标记文件,告知 CC Switch 以便携模式运行
            extra_entries: vec!["portable.ini".into()],
            extract_all: false,
            raw_exe: false,
            homepage: "https://ccswitch.io".into(),
        },
        ToolSpec {
            id: "notepad--".into(),
            name: "Notepad--".into(),
            group: "editor".into(),
            description: "轻量开源文本编辑器(类 Notepad++,支持多标签、列编辑、文件搜索、Lua 插件),Windows 10 x64 便携版,下载后存放在本应用数据目录,双击卡片即可打开。"
                .into(),
            // RedirectTag: releases/latest 302 到 .../releases/tag/<tag>,
            // 用真实 tag + 版本拼装带版本号的便携包地址(tag 命名规律变化不影响更新)
            download_url:
                "https://github.com/cxasm/notepad--/releases/download/{tag}/Notepad--v{version}-win10-portable.zip"
                    .into(),
            update_url: "https://github.com/cxasm/notepad--/releases/latest".into(),
            fallback_page_url: String::new(),
            version_source: VersionSource::RedirectTag,
            exe_entry: "Notepad--.exe".into(),
            // Qt 运行库、plugin/、themes/ 等都不可缺,整包解压
            extra_entries: vec![],
            extract_all: true,
            raw_exe: false,
            homepage: "https://github.com/cxasm/notepad--".into(),
        },
        ToolSpec {
            id: "hiddify".into(),
            name: "Hiddify".into(),
            group: "system".into(),
            description: "基于 sing-box 的多平台代理客户端(自动选点、TUN 模式、订阅管理,广告免费开源),Windows x64 便携版,下载后存放在本应用数据目录,双击卡片即可打开。".into(),
            // RedirectTag: releases/latest 302 到 .../releases/tag/<tag>,
            // 便携包文件名固定(不含版本号),用真实 tag 拼装下载地址(tag 命名变化不影响更新)。
            // 注意: 上游从 v4.x 起 .zip 发布物实际是 tar 归档,解压按魔数自动识别 zip/tar
            download_url:
                "https://github.com/hiddify/hiddify-app/releases/download/{tag}/Hiddify-Windows-Portable-x64.zip"
                    .into(),
            update_url: "https://github.com/hiddify/hiddify-app/releases/latest".into(),
            fallback_page_url: String::new(),
            version_source: VersionSource::RedirectTag,
            exe_entry: "Hiddify.exe".into(),
            // Flutter 应用,运行库/资源/插件不可缺,整包解压(单层顶层目录会被自动剥离)
            extra_entries: vec![],
            extract_all: true,
            raw_exe: false,
            homepage: "https://hiddify.com".into(),
        },
        ToolSpec {
            id: "magpie".into(),
            name: "Magpie".into(),
            group: "ai".into(),
            description: "AI 代理网关,将 Claude Code、Codex、Gemini CLI 等代理路由到任意模型/供应商(支持 OpenAI / Anthropic / Gemini 协议互转、多 key 轮换和自动故障转移),Windows x64 便携版,下载后存放在本应用数据目录。".into(),
            // RedirectTag: releases/latest 302 到 .../releases/tag/<tag>,
            // 用 tag 拼装裸 exe 下载地址(发布物为单个 .exe,非 zip)
            download_url:
                "https://github.com/yetone/magpie-releases/releases/download/{tag}/magpie-windows-amd64.exe"
                    .into(),
            update_url: "https://github.com/yetone/magpie-releases/releases/latest".into(),
            fallback_page_url: String::new(),
            version_source: VersionSource::RedirectTag,
            exe_entry: "magpie.exe".into(),
            extra_entries: vec![],
            extract_all: false,
            raw_exe: true,
            homepage: "https://usemagpie.ai".into(),
        },
    ]
}

fn find_spec(tool_id: &str) -> Option<ToolSpec> {
    registry().into_iter().find(|s| s.id == tool_id)
}

// ===== 已装工具状态(tools.json)=====

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ToolState {
    pub version: String,
    pub exe_path: String,
    pub installed_at: String,
    pub last_checked: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ToolsState {
    pub tools: BTreeMap<String, ToolState>,
}

// ===== 返回给前端的类型 =====

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolListItem {
    pub id: String,
    pub name: String,
    pub group: String,
    pub group_name: String,
    pub description: String,
    pub homepage: String,
    pub installed: bool,
    pub version: String,
    pub exe_path: String,
    pub installed_at: String,
    pub last_checked: String,
    pub has_update: bool,
    pub latest_version: String,
    pub changelog: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub has_update: bool,
    pub latest_version: String,
    pub changelog: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub tool_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub percent: u32,
}

// ===== 路径 =====

fn data_root() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(APP_DATA_DIR)
}

fn tool_install_dir(tool_id: &str) -> PathBuf {
    data_root().join("tools").join(tool_id)
}

fn state_path() -> PathBuf {
    data_root().join("tools.json")
}

// ===== 状态文件读写(原子写)=====

fn load_state() -> ToolsState {
    let path = state_path();
    if !path.exists() {
        return ToolsState::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_state(state: &ToolsState) -> Result<(), String> {
    let dir = data_root();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = state_path();
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &json).map_err(|e| e.to_string())?;
    match fs::rename(&tmp, &path) {
        Ok(()) => Ok(()),
        Err(_) if path.exists() => {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
            fs::rename(&tmp, &path).map_err(|e| e.to_string())
        }
        Err(e) => Err(e.to_string()),
    }
}

fn build_item(spec: &ToolSpec, state: &ToolsState) -> ToolListItem {
    let st = state.tools.get(&spec.id);
    ToolListItem {
        id: spec.id.clone(),
        name: spec.name.clone(),
        group: spec.group.clone(),
        group_name: group_display_name(&spec.group),
        description: spec.description.clone(),
        homepage: spec.homepage.clone(),
        installed: st.is_some(),
        version: st.map(|s| s.version.clone()).unwrap_or_default(),
        exe_path: st.map(|s| s.exe_path.clone()).unwrap_or_default(),
        installed_at: st.map(|s| s.installed_at.clone()).unwrap_or_default(),
        last_checked: st.map(|s| s.last_checked.clone()).unwrap_or_default(),
        has_update: false,
        latest_version: String::new(),
        changelog: Vec::new(),
    }
}

// ===== 命令 =====

#[tauri::command]
pub fn tool_list() -> Result<Vec<ToolListItem>, String> {
    let state = load_state();
    Ok(registry()
        .into_iter()
        .map(|spec| build_item(&spec, &state))
        .collect())
}

#[tauri::command]
pub async fn tool_check_updates(tool_id: String) -> Result<UpdateInfo, String> {
    let spec = find_spec(&tool_id).ok_or_else(|| format!("工具不存在: {tool_id}"))?;
    let (version, changelog) = resolve_latest(&spec).await?;

    let mut state = load_state();
    let installed_version = state
        .tools
        .get(&tool_id)
        .map(|s| s.version.clone())
        .unwrap_or_default();
    let has_update = is_newer(&version, &installed_version);
    if let Some(st) = state.tools.get_mut(&tool_id) {
        st.last_checked = now_iso();
        let _ = save_state(&state);
    }

    Ok(UpdateInfo {
        has_update,
        latest_version: version,
        changelog,
    })
}

#[tauri::command]
pub async fn tool_download(app: AppHandle, tool_id: String) -> Result<ToolListItem, String> {
    install_tool(&app, &tool_id).await
}

#[tauri::command]
pub async fn tool_update(app: AppHandle, tool_id: String) -> Result<ToolListItem, String> {
    install_tool(&app, &tool_id).await
}

#[tauri::command]
pub async fn tool_launch(tool_id: String) -> Result<(), String> {
    let state = load_state();
    let st = state
        .tools
        .get(&tool_id)
        .ok_or_else(|| "工具未下载,请先下载".to_string())?;
    if st.exe_path.is_empty() {
        return Err("工具路径为空,请重新下载".into());
    }
    let path = st.exe_path.replace('/', "\\");
    if !Path::new(&path).exists() {
        return Err(format!("可执行文件不存在: {path}"));
    }
    spawn_exe(&path)
}

/// 启动 exe;工作目录设为 exe 所在目录(便携程序常依赖相对路径的运行库/配置)。
/// 目标程序清单要求管理员权限(Windows os error 740)时,回退用 runas 触发 UAC 提升。
fn spawn_exe(path: &str) -> Result<(), String> {
    use std::process::Command;
    let mut cmd = Command::new(path);
    if let Some(parent) = Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            cmd.current_dir(parent);
        }
    }
    match cmd.spawn() {
        Ok(_) => Ok(()),
        Err(e) => {
            #[cfg(windows)]
            if e.raw_os_error() == Some(740) {
                return shell_execute_runas(path, "");
            }
            Err(format!("启动失败: {e}"))
        }
    }
}

#[tauri::command]
pub fn tool_is_elevated() -> bool {
    is_elevated()
}

#[tauri::command]
pub async fn tool_restart_elevated(app: AppHandle) -> Result<bool, String> {
    if is_elevated() {
        return Ok(false);
    }
    #[cfg(windows)]
    {
        let exe = std::env::current_exe().map_err(|e| format!("无法获取程序路径: {e}"))?;
        let exe_path = exe.to_string_lossy().replace('/', "\\");
        shell_execute_runas(&exe_path, "")?;
        app.exit(0);
        return Ok(true);
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("当前平台不支持以管理员身份重启".into())
    }
}

#[cfg(windows)]
fn is_elevated() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut ret_len = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            &mut elevation as *mut _ as *mut core::ffi::c_void,
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut ret_len,
        );
        CloseHandle(token);
        ok != 0 && elevation.TokenIsElevated != 0
    }
}

#[cfg(not(windows))]
fn is_elevated() -> bool {
    false
}

#[cfg(windows)]
fn shell_execute_runas(exe_path: &str, params: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let verb: Vec<u16> = "runas\0".encode_utf16().collect();
    let file: Vec<u16> = exe_path.encode_utf16().chain(std::iter::once(0)).collect();
    let params_w: Vec<u16> = if params.is_empty() {
        Vec::new()
    } else {
        params.encode_utf16().chain(std::iter::once(0)).collect()
    };
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            if params.is_empty() {
                std::ptr::null()
            } else {
                params_w.as_ptr()
            },
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    let code = result as isize;
    if code <= 32 {
        return Err(format!("ShellExecute 返回码 {code}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn tool_open_dir(tool_id: String) -> Result<(), String> {
    use std::process::Command;
    let state = load_state();
    let st = state
        .tools
        .get(&tool_id)
        .ok_or_else(|| "工具未下载".to_string())?;
    let exe = st.exe_path.replace('/', "\\");
    let dir = Path::new(&exe)
        .parent()
        .ok_or_else(|| "无法获取目录".to_string())?
        .to_path_buf();
    if !dir.exists() {
        return Err(format!("目录不存在: {}", dir.display()));
    }
    Command::new("explorer.exe")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("打开目录失败: {e}"))?;
    Ok(())
}

// ===== 自定义工具(用户拖入的 exe 启动器)=====

/// 智能打开用户登记的自定义 exe:
/// - 未运行 → 启动(工作目录设为 exe 所在目录,清单要求管理员时走 UAC 提升);
/// - 已运行且能定位到主窗口 → 把已有窗口切到前台,返回 "focused";
/// - 已运行但找不到可聚焦窗口(托盘常驻/无窗口程序)→ 返回 "running",不再启动第二个;
/// - 全新启动 → 返回 "launched"。
#[tauri::command]
pub fn custom_tool_open(exe_path: String) -> Result<String, String> {
    let path = if cfg!(windows) {
        exe_path.replace('/', "\\")
    } else {
        exe_path.clone()
    };
    if path.trim().is_empty() {
        return Err("路径为空".into());
    }
    if !Path::new(&path).exists() {
        return Err(format!("文件不存在,可能已被移动或删除: {path}"));
    }

    #[cfg(windows)]
    {
        if let Some(pid) = find_running_pid_by_exe(&path) {
            return if focus_window_by_pid(pid) {
                Ok("focused".into())
            } else {
                Ok("running".into())
            };
        }
    }

    spawn_exe(&path)?;
    Ok("launched".into())
}

/// 打开自定义 exe 所在目录。
#[tauri::command]
pub fn custom_tool_open_dir(exe_path: String) -> Result<(), String> {
    let path = exe_path.replace('/', "\\");
    let dir = Path::new(&path)
        .parent()
        .ok_or_else(|| "无法获取目录".to_string())?;
    if !dir.exists() {
        return Err(format!("目录不存在: {}", dir.display()));
    }
    std::process::Command::new("explorer.exe")
        .arg(dir)
        .spawn()
        .map_err(|e| format!("打开目录失败: {e}"))?;
    Ok(())
}

/// exe 路径归一化用于比较:统一反斜杠 + 小写(Windows 路径大小写不敏感)。
#[cfg(windows)]
fn normalize_exe_key(p: &str) -> String {
    p.replace('/', "\\").to_lowercase()
}

/// 按 exe 完整路径查找正在运行的进程 PID(取第一个命中的)。
#[cfg(windows)]
fn find_running_pid_by_exe(target: &str) -> Option<u32> {
    use sysinfo::{ProcessesToUpdate, System};
    let want = normalize_exe_key(target);
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    for (pid, process) in sys.processes() {
        if let Some(exe) = process.exe() {
            if normalize_exe_key(&exe.to_string_lossy()) == want {
                return Some(pid.as_u32());
            }
        }
    }
    None
}

/// 枚举顶层窗口,找到属于该 PID 的可见主窗口(无 owner)并切到前台。
/// 找到并尝试聚焦返回 true;该进程没有可聚焦的顶层窗口返回 false。
#[cfg(windows)]
fn focus_window_by_pid(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, EnumWindows, GetWindow, GetWindowThreadProcessId, IsWindowVisible,
        SetForegroundWindow, ShowWindow, GW_OWNER, SW_RESTORE,
    };

    struct Search {
        pid: u32,
        hwnd: HWND,
    }

    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let search = &mut *(lparam as *mut Search);
        // 只认可见的顶层窗口(无 owner),跳过工具窗口/隐藏窗口。
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }
        if !GetWindow(hwnd, GW_OWNER).is_null() {
            return 1;
        }
        let mut window_pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut window_pid);
        if window_pid == search.pid {
            search.hwnd = hwnd;
            return 0;
        }
        1
    }

    let mut search = Search {
        pid,
        hwnd: std::ptr::null_mut(),
    };
    unsafe {
        EnumWindows(Some(callback), &mut search as *mut Search as LPARAM);
        if search.hwnd.is_null() {
            return false;
        }
        ShowWindow(search.hwnd, SW_RESTORE);
        BringWindowToTop(search.hwnd);
        // SetForegroundWindow 可能被系统前台锁定策略拒绝,但窗口已还原/置顶,
        // 视为已定位到实例。
        SetForegroundWindow(search.hwnd);
    }
    true
}

// ===== 内部实现 =====

async fn install_tool(app: &AppHandle, tool_id: &str) -> Result<ToolListItem, String> {
    let spec = find_spec(tool_id).ok_or_else(|| format!("工具不存在: {tool_id}"))?;

    // 1. 解析最新版本与实际下载地址
    // LatestJson 必须先拿到 asset URL;KeyValueTxt / RedirectTag 的下载地址由版本号拼装,
    // 这些来源版本解析失败都必须中断;其它来源版本失败不阻断下载。
    let (mut version, download_url) = match spec.version_source {
        VersionSource::LatestJson => {
            let release = resolve_latest_json(&spec).await?;
            (release.version, release.download_url)
        }
        VersionSource::KeyValueTxt => {
            let (version, _) = resolve_latest(&spec).await?;
            let url = expand_version_template(&spec.download_url, &version, "")?;
            (version, url)
        }
        VersionSource::RedirectTag => {
            let (tag, version) = resolve_redirect_tag_version(&spec.update_url).await?;
            let url = expand_version_template(&spec.download_url, &version, &tag)?;
            (version, url)
        }
        _ => {
            let version = match resolve_latest(&spec).await {
                Ok((v, _)) => v,
                Err(_) => String::new(),
            };
            (version, spec.download_url.clone())
        }
    };

    // 2. 流式下载安装包到临时文件
    let tmp = std::env::temp_dir().join(format!("devhub-{tool_id}.zip"));
    let final_url = match download_with_progress(app, tool_id, &download_url, &tmp).await {
        Ok(url) => url,
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }
    };

    // RedirectFilename: 以实际落地包文件名为准
    if spec.version_source == VersionSource::RedirectFilename {
        if let Some(v) = version_from_download_name(&final_url) {
            version = v;
        }
    }
    // LatestJson: 若清单未给出版本,再从最终 URL 文件名兜底
    if spec.version_source == VersionSource::LatestJson && version.is_empty() {
        if let Some(v) = version_from_download_name(&final_url) {
            version = v;
        }
    }

    // 3. 解压 exe + 附属文件(或整包),或直接放置裸 exe
    let install_dir = tool_install_dir(tool_id);
    let extracted = if spec.raw_exe {
        install_raw_exe(&tmp, &spec.exe_entry, &install_dir)
    } else if spec.extract_all {
        extract_all_entries(&tmp, &spec.exe_entry, &install_dir)
    } else {
        let mut entries = Vec::with_capacity(1 + spec.extra_entries.len());
        entries.push(spec.exe_entry.clone());
        entries.extend(spec.extra_entries.iter().cloned());
        extract_entries(&tmp, &entries, &spec.exe_entry, &install_dir)
    };
    let exe_path = match extracted {
        Ok(path) => path,
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }
    };
    let _ = fs::remove_file(&tmp);

    // 4. 写状态
    let now = now_iso();
    let mut state = load_state();
    state.tools.insert(
        tool_id.to_string(),
        ToolState {
            version,
            exe_path: exe_path.to_string_lossy().to_string(),
            installed_at: now.clone(),
            last_checked: now,
        },
    );
    save_state(&state)?;

    Ok(build_item(&spec, &state))
}

struct LatestJsonRelease {
    version: String,
    changelog: Vec<String>,
    download_url: String,
}

async fn resolve_latest(spec: &ToolSpec) -> Result<(String, Vec<String>), String> {
    match spec.version_source {
        VersionSource::UpdateTxt => {
            let text = fetch_text(&spec.update_url).await?;
            Ok(parse_update_txt(&text))
        }
        VersionSource::RedirectFilename => {
            let version = resolve_redirect_version(&spec.download_url).await?;
            Ok((version, Vec::new()))
        }
        VersionSource::LatestJson => {
            let release = resolve_latest_json(spec).await?;
            Ok((release.version, release.changelog))
        }
        VersionSource::KeyValueTxt => {
            // 官方版本接口只给版本号,不给 changelog(留空则前端不渲染更新内容)
            let version = resolve_key_value_version(spec).await?;
            Ok((version, Vec::new()))
        }
        VersionSource::RedirectTag => {
            let (_, version) = resolve_redirect_tag_version(&spec.update_url).await?;
            Ok((version, Vec::new()))
        }
    }
}

/// KeyValueTxt: 先读官方版本接口(`KEY=VALUE` 文本),
/// 接口不可用或没有 `VERSION=` 时,回退扫描下载页面里的便携包文件名。
async fn resolve_key_value_version(spec: &ToolSpec) -> Result<String, String> {
    let primary = match fetch_text(&spec.update_url).await {
        Ok(text) => parse_key_value_version(&text),
        Err(_) => None,
    };
    if let Some(version) = primary {
        return Ok(version);
    }
    if !spec.fallback_page_url.is_empty() {
        let html = fetch_text(&spec.fallback_page_url).await?;
        if let Some(version) = scan_page_version(&html, &spec.download_url) {
            return Ok(version);
        }
    }
    Err("无法解析最新版本".into())
}

/// 解析 latest.json: 版本 + changelog + 实际下载地址。
async fn resolve_latest_json(spec: &ToolSpec) -> Result<LatestJsonRelease, String> {
    let text = fetch_text(&spec.update_url).await?;
    parse_latest_json(&text, &spec.download_url)
}

fn parse_latest_json(text: &str, download_spec: &str) -> Result<LatestJsonRelease, String> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("解析 latest.json 失败: {e}"))?;

    let version = value
        .get("version")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            value
                .get("tagName")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().trim_start_matches('v'))
                .filter(|s| !s.is_empty())
        })
        .unwrap_or("")
        .to_string();

    // GoNavi: releaseNotes; DBX/Tauri: notes
    let changelog = value
        .get("releaseNotes")
        .or_else(|| value.get("notes"))
        .and_then(|v| v.as_str())
        .map(parse_release_notes)
        .unwrap_or_default();

    let spec = download_spec.trim();
    if spec.is_empty() {
        return Err("未配置下载资源匹配规则".into());
    }

    // 1) URL 模板(含 {version})或绝对 URL — 用于 DBX 便携包等不在 platforms 里的资源
    if spec.contains("{version}") || looks_like_absolute_url(spec) {
        if spec.contains("{version}") && version.is_empty() {
            return Err("latest.json 缺少 version,无法展开下载地址".into());
        }
        let download_url = spec.replace("{version}", &version);
        return Ok(LatestJsonRelease {
            version,
            changelog,
            download_url,
        });
    }

    // 2) GoNavi 类: assets[] 按文件名后缀匹配,优先 url,回退 apiUrl
    if let Some(assets) = value.get("assets").and_then(|v| v.as_array()) {
        let mut matched: Option<&serde_json::Value> = None;
        for asset in assets {
            let name = asset.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if name_ends_with_ignore_case(name, spec) {
                matched = Some(asset);
                break;
            }
        }
        let asset = matched.ok_or_else(|| format!("latest.json 中未找到资源: *{spec}"))?;
        let download_url = asset
            .get("url")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .or_else(|| {
                asset
                    .get("apiUrl")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
            })
            .ok_or_else(|| format!("资源缺少下载地址: *{spec}"))?
            .to_string();
        return Ok(LatestJsonRelease {
            version,
            changelog,
            download_url,
        });
    }

    // 3) Tauri 类: platforms.<key>.url
    if let Some(platform) = value
        .get("platforms")
        .and_then(|v| v.as_object())
        .and_then(|m| m.get(spec))
    {
        let download_url = platform
            .get("url")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| format!("platforms.{spec} 缺少 url"))?
            .to_string();
        return Ok(LatestJsonRelease {
            version,
            changelog,
            download_url,
        });
    }

    Err(format!(
        "latest.json 无法解析下载地址(无 assets,且无 platforms.{spec})"
    ))
}

fn looks_like_absolute_url(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://")
}

fn parse_release_notes(notes: &str) -> Vec<String> {
    notes
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with('-'))
        .map(|line| {
            line.trim_start_matches('-')
                .trim()
                .trim_start_matches(['*', ' '])
                .trim()
                .to_string()
        })
        .filter(|line| !line.is_empty())
        .take(20)
        .collect()
}

fn name_ends_with_ignore_case(name: &str, suffix: &str) -> bool {
    let name_bytes = name.as_bytes();
    let suffix_bytes = suffix.as_bytes();
    if suffix_bytes.len() > name_bytes.len() {
        return false;
    }
    let start = name_bytes.len() - suffix_bytes.len();
    name_bytes[start..].eq_ignore_ascii_case(suffix_bytes)
}

/// 从 versionless 下载链接的 302 Location(或跟随后的最终 URL)解析版本号。
async fn resolve_redirect_version(url: &str) -> Result<String, String> {
    // 先不跟随重定向,读 Location
    let no_redirect = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    match no_redirect.head(url).send().await {
        Ok(resp) => {
            if resp.status().is_redirection() {
                if let Some(loc) = resp
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|v| v.to_str().ok())
                {
                    if let Some(v) = version_from_download_name(loc) {
                        return Ok(v);
                    }
                }
            }
            // 少数环境 HEAD 直接 200 且 url 已是最终地址
            if let Some(v) = version_from_download_name(resp.url().as_str()) {
                return Ok(v);
            }
        }
        Err(_) => {
            // HEAD 失败则走 GET 跟随
        }
    }

    // fallback: 跟随重定向的 HEAD/GET,用最终 URL
    let follow = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let resp = match follow.head(url).send().await {
        Ok(r) if r.status().is_success() || r.status().is_redirection() => r,
        _ => follow
            .get(url)
            .send()
            .await
            .map_err(|e| format!("请求失败: {e}"))?,
    };

    version_from_download_name(resp.url().as_str())
        .ok_or_else(|| format!("无法从下载地址解析版本: {}", resp.url()))
}

async fn fetch_text(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.text()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))
}

/// RedirectTag: 发布入口(如 GitHub `releases/latest`)302 到 `.../releases/tag/<tag>`,
/// 从 Location(或跟随后的最终 URL)解析 tag,返回 (tag, 从 tag 提取的版本号)。
async fn resolve_redirect_tag_version(url: &str) -> Result<(String, String), String> {
    // 先不跟随重定向,读 Location
    let no_redirect = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    if let Ok(resp) = no_redirect.head(url).send().await {
        if resp.status().is_redirection() {
            if let Some(pair) = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .and_then(tag_and_version_from_release_url)
            {
                return Ok(pair);
            }
        }
    }

    // fallback: 跟随重定向,用最终 URL
    let follow = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let resp = match follow.head(url).send().await {
        Ok(r) if r.status().is_success() || r.status().is_redirection() => r,
        _ => follow
            .get(url)
            .send()
            .await
            .map_err(|e| format!("请求失败: {e}"))?,
    };

    tag_and_version_from_release_url(resp.url().as_str())
        .ok_or_else(|| format!("无法从更新入口解析版本: {}", resp.url()))
}

/// 从 `.../releases/tag/<tag>` 类 URL 中提取 tag,并从 tag 里解析其中的点分数字版本。
fn tag_and_version_from_release_url(url: &str) -> Option<(String, String)> {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let idx = path.rfind("/tag/")?;
    let tag = path[idx + "/tag/".len()..]
        .trim_end_matches('/')
        .to_string();
    let version = version_from_tag(&tag)?;
    Some((tag, version))
}

/// 从 tag / 名称中提取最长的点分数字版本,例如 `notepad-v3.9.0` → `3.9.0`。
fn version_from_tag(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut i = 0;
    let mut best: Option<Vec<u64>> = None;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
                i += 1;
            }
            let mut end = i;
            while end > start && bytes[end - 1] == b'.' {
                end -= 1;
            }
            let parts: Vec<u64> = input[start..end]
                .split('.')
                .filter(|p| !p.is_empty())
                .filter_map(|p| p.parse::<u64>().ok())
                .collect();
            if parts.is_empty() {
                continue;
            }
            let better = match &best {
                Some(b) => parts.len() > b.len() || (parts.len() == b.len() && parts > *b),
                None => true,
            };
            if better {
                best = Some(parts);
            }
        } else {
            i += 1;
        }
    }
    best.map(|parts| {
        parts
            .iter()
            .map(u64::to_string)
            .collect::<Vec<_>>()
            .join(".")
    })
}

/// 下载并返回最终 URL(跟随重定向后),便于从文件名解析版本。
async fn download_with_progress(
    app: &AppHandle,
    tool_id: &str,
    url: &str,
    dest: &Path,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        // 大文件(Hiddify 便携包 ~112MB)慢速链路下 180s 总超时会中途掐断,
        // 卡死检测交给读超时,总超时只作兜底
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(60))
        .timeout(std::time::Duration::from_secs(1800))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("请求下载失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载失败: HTTP {}", resp.status()));
    }
    let final_url = resp.url().to_string();
    let total = resp.content_length().unwrap_or(0);
    let mut file = fs::File::create(dest).map_err(|e| format!("创建临时文件失败: {e}"))?;
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取数据失败: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("写入文件失败: {e}"))?;
        downloaded += chunk.len() as u64;
        let percent = if total > 0 {
            (downloaded * 100 / total) as u32
        } else {
            0
        };
        let _ = app.emit(
            "tool-download-progress",
            DownloadProgress {
                tool_id: tool_id.to_string(),
                downloaded,
                total,
                percent,
            },
        );
    }
    file.flush().map_err(|e| format!("写入文件失败: {e}"))?;
    Ok(final_url)
}

/// 直接将下载的裸 exe 放入工具目录(不经过解压)。
/// 安装前清空工具目录,避免更新后残留旧文件;目录被占用(工具正在运行)时明确报错。
fn install_raw_exe(tmp_path: &Path, exe_entry: &str, dest_dir: &Path) -> Result<PathBuf, String> {
    if dest_dir.exists() {
        fs::remove_dir_all(dest_dir).map_err(|e| {
            format!("清空工具目录失败(若该工具正在运行,请先关闭后重试): {e}")
        })?;
    }
    fs::create_dir_all(dest_dir).map_err(|e| format!("创建目录失败: {e}"))?;
    let dest = dest_dir.join(exe_entry);
    fs::copy(tmp_path, &dest).map_err(|e| format!("复制文件失败: {e}"))?;
    Ok(dest)
}

/// 安装包实际格式。发布物扩展名可能与内容不符(Hiddify v4.x 起名为 .zip 实为 tar),
/// 以文件头魔数为准选择解压器。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PkgFormat {
    Zip,
    Tar,
}

/// 按文件头魔数识别安装包格式:zip 为 `PK\x03\x04`(空包/分卷为 `PK\x05\x06`/`PK\x07\x08`),
/// tar 为偏移 257 处的 `ustar`;都不匹配时报错并附文件头十六进制,便于区分下载不完整与上游换格式。
fn detect_pkg_format(path: &Path) -> Result<PkgFormat, String> {
    let mut head = Vec::with_capacity(262);
    fs::File::open(path)
        .and_then(|f| f.take(262).read_to_end(&mut head))
        .map_err(|e| format!("读取安装包文件头失败: {e}"))?;
    if head.starts_with(b"PK\x03\x04")
        || head.starts_with(b"PK\x05\x06")
        || head.starts_with(b"PK\x07\x08")
    {
        return Ok(PkgFormat::Zip);
    }
    if head.len() >= 262 && head[257..262] == *b"ustar" {
        return Ok(PkgFormat::Tar);
    }
    let hex = head
        .iter()
        .take(8)
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(" ");
    Err(format!(
        "安装包不是有效的 zip 或 tar 格式(文件头前 8 字节: {hex}),可能下载不完整或上游发布物格式已变更"
    ))
}

/// 解压指定条目;返回主 exe 路径。
/// 条目含 `/` 时按相对路径落地(如 WizTree 的 locale/zh_CHS/LC_MESSAGES/default.mo),
/// 否则沿用 basename 拍平写入工具目录。
fn extract_entries(
    zip_path: &Path,
    entries: &[String],
    exe_entry: &str,
    dest_dir: &Path,
) -> Result<PathBuf, String> {
    fs::create_dir_all(dest_dir).map_err(|e| format!("创建目录失败: {e}"))?;
    // 按条目解压只实现了 zip;现注册表中该路径的发布物均为真 zip(tar 误标仅 Hiddify 使用,走整包解压)
    match detect_pkg_format(zip_path)? {
        PkgFormat::Zip => {}
        PkgFormat::Tar => {
            return Err("安装包是 tar 归档,该工具的按条目解压配置暂不支持 tar".into());
        }
    }
    let file = fs::File::open(zip_path).map_err(|e| format!("打开 zip 失败: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(BufReader::new(file)).map_err(|e| format!("打开 zip 失败: {e}"))?;

    let mut exe_path: Option<PathBuf> = None;

    for wanted in entries {
        // 落地路径只由注册表条目决定(不采用压缩包内的路径),这里再挡一次 ..
        if wanted.split(['/', '\\']).any(|seg| seg == "..") {
            return Err(format!("非法条目路径: {wanted}"));
        }
        let mut found_idx: Option<usize> = None;
        for i in 0..archive.len() {
            let name = archive
                .by_index(i)
                .map_err(|e| format!("读取压缩包条目失败: {e}"))?
                .name()
                .to_string();
            if entry_matches(&name, wanted) {
                found_idx = Some(i);
                break;
            }
        }
        let idx = found_idx.ok_or_else(|| format!("压缩包内未找到 {wanted}"))?;
        let mut entry = archive
            .by_index(idx)
            .map_err(|e| format!("读取压缩包条目失败: {e}"))?;
        if entry.is_dir() {
            return Err(format!("压缩包条目是目录: {wanted}"));
        }
        let dest_path = if is_path_entry(wanted) {
            dest_dir.join(relative_dest(wanted))
        } else {
            dest_dir.join(entry_name_as_is(entry.name()))
        };
        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
        let mut out = fs::File::create(&dest_path).map_err(|e| format!("创建文件失败: {e}"))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("解压失败: {e}"))?;
        out.flush().map_err(|e| e.to_string())?;
        if matches_entry(wanted, exe_entry) {
            exe_path = Some(dest_path);
        }
    }

    exe_path.ok_or_else(|| format!("压缩包内未找到 {exe_entry}"))
}

/// 整包解压到工具目录:按文件头魔数识别 zip/tar 后分别解压。
/// 所有条目共享同一个顶层目录时剥离它,exe 按 basename 匹配定位。
/// 解压前清空工具目录,避免更新后残留旧文件;目录被占用(工具正在运行)时明确报错。
fn extract_all_entries(pkg_path: &Path, exe_entry: &str, dest_dir: &Path) -> Result<PathBuf, String> {
    if dest_dir.exists() {
        fs::remove_dir_all(dest_dir).map_err(|e| {
            format!("清空工具目录失败(若该工具正在运行,请先关闭后重试): {e}")
        })?;
    }
    fs::create_dir_all(dest_dir).map_err(|e| format!("创建目录失败: {e}"))?;
    match detect_pkg_format(pkg_path)? {
        PkgFormat::Zip => extract_all_zip(pkg_path, exe_entry, dest_dir),
        PkgFormat::Tar => extract_all_tar(pkg_path, exe_entry, dest_dir),
    }
}

/// zip 整包解压(顶层目录剥离逻辑与 tar 共用)。
fn extract_all_zip(zip_path: &Path, exe_entry: &str, dest_dir: &Path) -> Result<PathBuf, String> {
    let file = fs::File::open(zip_path).map_err(|e| format!("打开 zip 失败: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(BufReader::new(file)).map_err(|e| format!("打开 zip 失败: {e}"))?;

    // 解析每个条目的安全相对路径组件
    let mut rels: Vec<(usize, Vec<String>)> = Vec::with_capacity(archive.len());
    for i in 0..archive.len() {
        let name = archive
            .by_index(i)
            .map_err(|e| format!("读取压缩包条目失败: {e}"))?
            .name()
            .to_string();
        if let Some(comps) = safe_zip_components(&name) {
            rels.push((i, comps));
        }
    }
    let strip = strip_common_top_dir(&rels.iter().map(|(_, c)| c.as_slice()).collect::<Vec<_>>());

    let mut exe_path: Option<PathBuf> = None;
    for (idx, comps) in &rels {
        if comps.len() <= strip {
            continue;
        }
        let dest = dest_dir.join(comps[strip..].join("/"));
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
        let mut entry = archive
            .by_index(*idx)
            .map_err(|e| format!("读取压缩包条目失败: {e}"))?;
        if entry.is_dir() {
            continue;
        }
        let mut out = fs::File::create(&dest).map_err(|e| format!("创建文件失败: {e}"))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("解压失败: {e}"))?;
        out.flush().map_err(|e| e.to_string())?;
        if matches_entry(comps.last().map(String::as_str).unwrap_or_default(), exe_entry) {
            exe_path = Some(dest);
        }
    }

    exe_path.ok_or_else(|| format!("压缩包内未找到 {exe_entry}"))
}

/// tar 归档整包解压,安全校验与顶层目录剥离复用 zip 的同一套逻辑。
/// tar 是流式格式,先扫一遍条目名算出需剥离的顶层目录数,再重开文件逐条目落地。
fn extract_all_tar(tar_path: &Path, exe_entry: &str, dest_dir: &Path) -> Result<PathBuf, String> {
    let names: Vec<String> = {
        let file = fs::File::open(tar_path).map_err(|e| format!("打开 tar 包失败: {e}"))?;
        let mut archive = tar::Archive::new(BufReader::new(file));
        let mut names = Vec::new();
        for entry in archive
            .entries()
            .map_err(|e| format!("读取 tar 包失败: {e}"))?
        {
            let entry = entry.map_err(|e| format!("读取 tar 包条目失败: {e}"))?;
            match entry.header().entry_type() {
                tar::EntryType::Regular | tar::EntryType::Directory => {}
                // 链接类条目可指向包外路径,直接拒绝安装
                other => {
                    return Err(format!("tar 包内包含不支持的特殊条目({other:?}),已中止安装"));
                }
            }
            names.push(tar_entry_name(&entry));
        }
        names
    };
    let rels: Vec<Vec<String>> = names
        .iter()
        .filter_map(|name| safe_zip_components(name))
        .collect();
    let strip = strip_common_top_dir(&rels.iter().map(|c| c.as_slice()).collect::<Vec<_>>());

    let file = fs::File::open(tar_path).map_err(|e| format!("打开 tar 包失败: {e}"))?;
    let mut archive = tar::Archive::new(BufReader::new(file));
    let mut exe_path: Option<PathBuf> = None;
    for entry in archive
        .entries()
        .map_err(|e| format!("读取 tar 包失败: {e}"))?
    {
        let mut entry = entry.map_err(|e| format!("读取 tar 包条目失败: {e}"))?;
        if entry.header().entry_type() == tar::EntryType::Directory {
            continue;
        }
        let name = tar_entry_name(&entry);
        let Some(comps) = safe_zip_components(&name) else {
            continue;
        };
        if comps.len() <= strip {
            continue;
        }
        let dest = dest_dir.join(comps[strip..].join("/"));
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
        entry.unpack(&dest).map_err(|e| format!("解压失败: {e}"))?;
        if matches_entry(comps.last().map(String::as_str).unwrap_or_default(), exe_entry) {
            exe_path = Some(dest);
        }
    }

    exe_path.ok_or_else(|| format!("压缩包内未找到 {exe_entry}"))
}

fn tar_entry_name<R: Read>(entry: &tar::Entry<'_, R>) -> String {
    entry
        .path()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// zip 条目名 → 安全相对路径组件;绝对路径、含 `..` 或盘符/冒号的组件拒绝,空组件跳过。
fn safe_zip_components(name: &str) -> Option<Vec<String>> {
    let name = name.replace('\\', "/");
    if name.starts_with('/') {
        return None;
    }
    let mut comps: Vec<String> = Vec::new();
    for seg in name.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." || seg.contains(':') {
            return None;
        }
        comps.push(seg.to_string());
    }
    if comps.is_empty() {
        None
    } else {
        Some(comps)
    }
}

/// 所有条目共享同一个非空顶层组件时返回 1(剥离),否则返回 0(保持原样)。
fn strip_common_top_dir(all: &[&[String]]) -> usize {
    let first = match all.first() {
        Some(c) if !c.is_empty() => &c[0],
        _ => return 0,
    };
    if all.iter().all(|c| !c.is_empty() && &c[0] == first) {
        1
    } else {
        0
    }
}

// ===== 辅助 =====

fn parse_update_txt(text: &str) -> (String, Vec<String>) {
    let line = text.lines().next().unwrap_or("").trim();
    if line.is_empty() {
        return (String::new(), Vec::new());
    }
    let parts: Vec<&str> = line.split('|').collect();
    if parts.len() < 2 {
        return (String::new(), Vec::new());
    }
    let version = parts[1].trim().to_string();
    let changelog = parts[2..]
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    (version, changelog)
}

/// 解析 `KEY=VALUE` 文本里的版本号,取第一个 `VERSION` 键。
/// WizTree 官方版本接口返回:
/// `WIZTREEVERSION` / `VERSION=4.32` / `INFOURL=https://...`
fn parse_key_value_version(text: &str) -> Option<String> {
    text.lines()
        .filter_map(|line| line.split_once('='))
        .find(|(key, _)| key.trim().eq_ignore_ascii_case("version"))
        .map(|(_, value)| value.trim().trim_start_matches('v').trim().to_string())
        .filter(|v| v.starts_with(|c: char| c.is_ascii_digit()))
}

/// 用版本号与 tag 展开下载地址模板;版本为空或仍有未知占位符时报错。
/// 支持 `{version}`、`{version_underscore}`(4.32 → 4_32)和 `{tag}`(发布 tag,
/// 由 RedirectTag 源解析;其它源模板不得使用)。
const VERSION_UNDERSCORE: &str = "{version_underscore}";
const TAG_PLACEHOLDER: &str = "{tag}";

fn expand_version_template(template: &str, version: &str, tag: &str) -> Result<String, String> {
    if version.is_empty() {
        return Err("未获取到最新版本,无法拼接下载地址".into());
    }
    let mut expanded = template
        .replace(VERSION_UNDERSCORE, &version.replace('.', "_"))
        .replace("{version}", version);
    if expanded.contains(TAG_PLACEHOLDER) {
        let tag = tag.trim().trim_end_matches('/');
        if tag.is_empty() {
            return Err("未获取到发布 tag,无法拼接下载地址".into());
        }
        expanded = expanded.replace(TAG_PLACEHOLDER, tag);
    }
    if expanded.contains('{') {
        return Err(format!("下载地址模板含未知占位符: {template}"));
    }
    Ok(expanded)
}

/// 版本接口不可用时的兜底:按下载模板在页面 HTML 里扫描文件名。
/// 以占位符前的文件名片段为前缀(`wiztree_`)、其后片段为后缀(`_portable.zip`),
/// 中间必须全是数字和下划线;命中多个时取最高版本。
fn scan_page_version(html: &str, template: &str) -> Option<String> {
    let (before, after) = template.split_once(VERSION_UNDERSCORE)?;
    let prefix = basename(before);
    let suffix = after.split(['"', '\'', '<', '>', ' ']).next().unwrap_or(after);
    if prefix.is_empty() || suffix.is_empty() {
        return None;
    }
    let mut best: Option<String> = None;
    let mut rest = html;
    while let Some(start) = rest.find(prefix) {
        rest = &rest[start + prefix.len()..];
        let Some(end) = rest.find(suffix) else {
            continue;
        };
        let middle = &rest[..end];
        if middle.is_empty() || !middle.bytes().all(|b| b.is_ascii_digit() || b == b'_') {
            continue;
        }
        let candidate = middle.replace('_', ".");
        if best.as_deref().is_none_or(|b| is_newer(&candidate, b)) {
            best = Some(candidate);
        }
    }
    best
}

/// 从下载 URL 或文件名中提取点分数字版本,例如:
/// `Everything-1.4.1.1032.x64.zip` → `1.4.1.1032`
fn version_from_download_name(input: &str) -> Option<String> {
    let path = input.split('?').next().unwrap_or(input);
    let name = basename(path);
    let stem = name.rsplit_once('.').map(|(s, _)| s).unwrap_or(name);
    let bytes = stem.as_bytes();
    let mut i = 0;
    let mut best: Option<String> = None;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
                i += 1;
            }
            let mut end = i;
            while end > start && bytes[end - 1] == b'.' {
                end -= 1;
            }
            if end > start {
                let cand = &stem[start..end];
                let parts: Vec<&str> = cand.split('.').filter(|p| !p.is_empty()).collect();
                let ok = parts.len() >= 3
                    && parts
                        .iter()
                        .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()));
                if ok {
                    let better = best
                        .as_ref()
                        .map(|b| parts.len() > b.split('.').count() || cand.len() > b.len())
                        .unwrap_or(true);
                    if better {
                        best = Some(cand.to_string());
                    }
                }
            }
        } else {
            i += 1;
        }
    }
    best
}

fn parse_version(s: &str) -> Vec<u64> {
    s.split('.')
        .filter_map(|p| p.trim().parse::<u64>().ok())
        .collect()
}

fn is_newer(latest: &str, installed: &str) -> bool {
    let l = parse_version(latest);
    if l.is_empty() {
        return false;
    }
    let i = parse_version(installed);
    if i.is_empty() {
        return true;
    }
    l > i
}

fn now_iso() -> String {
    chrono::Local::now().to_rfc3339()
}

fn matches_entry(zip_name: &str, exe_entry: &str) -> bool {
    let z = basename(zip_name);
    let e = basename(exe_entry);
    if cfg!(windows) {
        z.eq_ignore_ascii_case(e)
    } else {
        z == e
    }
}

/// 注册表条目是否带路径(带路径的条目要保留目录结构)。
fn is_path_entry(wanted: &str) -> bool {
    wanted.contains('/') || wanted.contains('\\')
}

/// 压缩包条目与注册表条目是否匹配:带路径的按相对路径比(容忍压缩包多一层顶层目录),
/// 不带路径的沿用 basename 比。
fn entry_matches(zip_name: &str, wanted: &str) -> bool {
    if !is_path_entry(wanted) {
        return matches_entry(zip_name, wanted);
    }
    let mut z = zip_name.replace('\\', "/");
    let mut w = wanted.replace('\\', "/");
    if cfg!(windows) {
        z = z.to_ascii_lowercase();
        w = w.to_ascii_lowercase();
    }
    z == w || z.ends_with(&format!("/{w}"))
}

/// 带路径条目在工具目录下的相对落地路径(用注册表里的路径,不用压缩包里的路径)。
fn relative_dest(wanted: &str) -> PathBuf {
    wanted
        .replace('\\', "/")
        .split('/')
        .filter(|seg| !seg.is_empty())
        .collect()
}

fn basename(p: &str) -> &str {
    p.rsplit(['/', '\\']).next().unwrap_or(p)
}

fn entry_name_as_is(name: &str) -> String {
    basename(name).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_update_txt_fields() {
        let (version, changelog) = parse_update_txt(
            "180|1.5.4.180|Microsoft Edge removed|Fixed crashes|Minor fixes",
        );
        assert_eq!(version, "1.5.4.180");
        assert_eq!(
            changelog,
            vec![
                "Microsoft Edge removed",
                "Fixed crashes",
                "Minor fixes"
            ]
        );
    }

    #[test]
    fn parses_update_txt_handles_extra_whitespace() {
        let (version, changelog) = parse_update_txt("  180 | 1.5.4.180 | A | B |  ");
        assert_eq!(version, "1.5.4.180");
        assert_eq!(changelog, vec!["A", "B"]);
    }

    #[test]
    fn is_newer_compares_dot_versions() {
        assert!(is_newer("1.5.4.180", "1.5.4.170"));
        assert!(!is_newer("1.5.4.170", "1.5.4.180"));
        assert!(is_newer("1.5.5", "1.5.4.180"));
        assert!(!is_newer("1.5.4.180", "1.5.4.180"));
        assert!(is_newer("1.5.4.180", ""));
        assert!(!is_newer("", "1.5.4.180"));
        assert!(is_newer("1.4.1.1032", "1.4.1.1030"));
        assert!(!is_newer("1.4.1.1030", "1.4.1.1032"));
    }

    #[test]
    fn matches_entry_basename_case_insensitive_on_windows() {
        let same = if cfg!(windows) {
            matches_entry("Geek.EXE", "geek.exe")
        } else {
            matches_entry("geek.exe", "geek.exe")
        };
        assert!(same);
        assert!(matches_entry("geek.exe", "geek.exe"));
        assert!(!matches_entry("readme.txt", "geek.exe"));
        assert!(matches_entry("dir/geek.exe", "geek.exe"));
        assert!(matches_entry("Everything.exe", "Everything.exe"));
        assert!(matches_entry("Everything.lng", "Everything.lng"));
    }

    #[test]
    fn version_from_everything_download_names() {
        assert_eq!(
            version_from_download_name(
                "https://www.voidtools.com/Everything-1.4.1.1032.x64.zip"
            )
            .as_deref(),
            Some("1.4.1.1032")
        );
        assert_eq!(
            version_from_download_name("Everything-1.4.1.1032.x64.zip").as_deref(),
            Some("1.4.1.1032")
        );
        assert_eq!(
            version_from_download_name("/Everything-1.4.1.1030.x86.zip").as_deref(),
            Some("1.4.1.1030")
        );
        assert_eq!(
            version_from_download_name("https://example.com/Everything.x64.zip").as_deref(),
            None
        );
        assert_eq!(version_from_download_name("geek.zip").as_deref(), None);
    }

    #[test]
    fn registry_includes_geek_everything_gonavi_and_dbx() {
        let ids: Vec<_> = registry().into_iter().map(|s| s.id).collect();
        assert!(ids.contains(&"geek".to_string()));
        assert!(ids.contains(&"everything".to_string()));
        assert!(ids.contains(&"gonavi".to_string()));
        assert!(ids.contains(&"dbx".to_string()));
        let everything = find_spec("everything").unwrap();
        assert_eq!(everything.version_source, VersionSource::RedirectFilename);
        assert!(everything
            .extra_entries
            .iter()
            .any(|e| e.eq_ignore_ascii_case("Everything.lng")));
        let gonavi = find_spec("gonavi").unwrap();
        assert_eq!(gonavi.version_source, VersionSource::LatestJson);
        assert_eq!(gonavi.exe_entry, "GoNavi.exe");
        assert!(gonavi
            .download_url
            .ends_with("Windows-Amd64-Portable.zip"));
        let dbx = find_spec("dbx").unwrap();
        assert_eq!(dbx.version_source, VersionSource::LatestJson);
        assert_eq!(dbx.exe_entry, "DBX.exe");
        assert!(dbx.download_url.contains("{version}"));
        assert!(dbx
            .extra_entries
            .iter()
            .any(|e| e.eq_ignore_ascii_case("portable.dbx")));
    }

    #[test]
    fn parse_latest_json_picks_windows_portable_zip() {
        let notes = [
            "Features",
            "",
            "- feat(ssh): auto confirm prompts",
            "- fix(window): restore crop",
            "",
            "Other",
            "plain line",
        ]
        .join("\n");
        let json = serde_json::json!({
            "version": "0.9.4",
            "tagName": "v0.9.4",
            "releaseNotes": notes,
            "assets": [
                {
                    "name": "GoNavi-0.9.4-Windows-Amd64-Installer.msi",
                    "url": "https://cdn.example/msi",
                    "apiUrl": "https://gh.example/msi"
                },
                {
                    "name": "GoNavi-0.9.4-Windows-Amd64-Portable.zip",
                    "url": "https://cdn.example/zip",
                    "apiUrl": "https://gh.example/zip"
                }
            ]
        })
        .to_string();
        let release = parse_latest_json(&json, "Windows-Amd64-Portable.zip").unwrap();
        assert_eq!(release.version, "0.9.4");
        assert_eq!(release.download_url, "https://cdn.example/zip");
        assert_eq!(
            release.changelog,
            vec![
                "feat(ssh): auto confirm prompts".to_string(),
                "fix(window): restore crop".to_string()
            ]
        );
    }

    #[test]
    fn parse_latest_json_falls_back_to_api_url_and_tag() {
        let json = serde_json::json!({
            "tagName": "v1.2.3",
            "assets": [{
                "name": "App-1.2.3-Windows-Amd64-Portable.zip",
                "apiUrl": "https://gh.example/App-1.2.3-Windows-Amd64-Portable.zip"
            }]
        })
        .to_string();
        let release = parse_latest_json(&json, "Windows-Amd64-Portable.zip").unwrap();
        assert_eq!(release.version, "1.2.3");
        assert_eq!(
            release.download_url,
            "https://gh.example/App-1.2.3-Windows-Amd64-Portable.zip"
        );
    }

    #[test]
    fn version_from_gonavi_download_names() {
        assert_eq!(
            version_from_download_name(
                "https://github.com/Syngnat/GoNavi/releases/download/v0.9.4/GoNavi-0.9.4-Windows-Amd64-Portable.zip"
            )
            .as_deref(),
            Some("0.9.4")
        );
    }

    #[test]
    fn parse_latest_json_expands_version_url_template() {
        let json = serde_json::json!({
            "version": "0.5.97",
            "notes": "### Features\n\n- grid screenshot\n- filter modes\nplain",
            "platforms": {
                "windows-x86_64": {
                    "url": "https://github.com/t8y2/dbx/releases/download/v0.5.97/DBX_0.5.97_x64_en-US.msi"
                }
            }
        })
        .to_string();
        let template =
            "https://github.com/t8y2/dbx/releases/download/v{version}/DBX_{version}_x64-portable.zip";
        let release = parse_latest_json(&json, template).unwrap();
        assert_eq!(release.version, "0.5.97");
        assert_eq!(
            release.download_url,
            "https://github.com/t8y2/dbx/releases/download/v0.5.97/DBX_0.5.97_x64-portable.zip"
        );
        assert_eq!(
            release.changelog,
            vec!["grid screenshot".to_string(), "filter modes".to_string()]
        );
    }

    #[test]
    fn parse_latest_json_reads_tauri_platform_url() {
        let json = serde_json::json!({
            "version": "0.5.97",
            "notes": "- a fix",
            "platforms": {
                "windows-x86_64": {
                    "url": "https://example.com/app.msi"
                }
            }
        })
        .to_string();
        let release = parse_latest_json(&json, "windows-x86_64").unwrap();
        assert_eq!(release.version, "0.5.97");
        assert_eq!(release.download_url, "https://example.com/app.msi");
        assert_eq!(release.changelog, vec!["a fix".to_string()]);
    }

    #[test]
    fn version_from_dbx_download_names() {
        assert_eq!(
            version_from_download_name(
                "https://github.com/t8y2/dbx/releases/download/v0.5.97/DBX_0.5.97_x64-portable.zip"
            )
            .as_deref(),
            Some("0.5.97")
        );
    }

    #[test]
    fn parses_wiztree_version_endpoint() {
        let text =
            "WIZTREEVERSION\nVERSION=4.32\nINFOURL=https://diskanalyzer.com/download?ref=upgrade\n";
        assert_eq!(parse_key_value_version(text).as_deref(), Some("4.32"));
        assert_eq!(
            parse_key_value_version("wiztreeversion\r\nversion = v4.09\r\n").as_deref(),
            Some("4.09")
        );
        assert_eq!(
            parse_key_value_version("WIZTREEVERSION\nINFOURL=x\n").as_deref(),
            None
        );
        assert_eq!(parse_key_value_version("VERSION=\n").as_deref(), None);
        assert_eq!(parse_key_value_version("<html>404</html>").as_deref(), None);
    }

    #[test]
    fn expands_wiztree_download_template() {
        let template = "https://diskanalyzer.com/files/wiztree_{version_underscore}_portable.zip";
        assert_eq!(
            expand_version_template(template, "4.32", "").unwrap(),
            "https://diskanalyzer.com/files/wiztree_4_32_portable.zip"
        );
        assert!(expand_version_template(template, "", "").is_err());
        assert!(expand_version_template("https://x/{unknown}.zip", "1.0", "").is_err());
        // {tag} 在 tag 缺失时必须报错,不静默保留占位符
        assert!(expand_version_template("https://x/dl/{tag}/a.zip", "1.0", "").is_err());
        assert_eq!(
            expand_version_template("https://x/v{version}/a-{version}.zip", "0.6.0", "").unwrap(),
            "https://x/v0.6.0/a-0.6.0.zip"
        );
        assert_eq!(
            expand_version_template("https://x/dl/{tag}/a-v{version}.zip", "3.9.0", "notepad-v3.9.0")
                .unwrap(),
            "https://x/dl/notepad-v3.9.0/a-v3.9.0.zip"
        );
    }

    #[test]
    fn scans_download_page_for_highest_portable_version() {
        let template = "https://diskanalyzer.com/files/wiztree_{version_underscore}_portable.zip";
        let html = concat!(
            "<samp>wiztree_4_14_setup.exe /VERYSILENT</samp>",
            "<a href=\"files/wiztree_4_31_portable.zip\">old</a>",
            "<a href=\"files/wiztree_4_32_setup.exe\">installer</a>",
            "<a href=\"files/wiztree_4_32_portable.zip\">portable</a>",
        );
        assert_eq!(scan_page_version(html, template).as_deref(), Some("4.32"));
        assert_eq!(scan_page_version("<html>no link</html>", template), None);
    }

    #[test]
    fn registry_includes_wiztree_portable_with_locale() {
        let wiztree = find_spec("wiztree").unwrap();
        assert_eq!(wiztree.version_source, VersionSource::KeyValueTxt);
        assert_eq!(wiztree.exe_entry, "WizTree64.exe");
        assert!(wiztree.download_url.contains(VERSION_UNDERSCORE));
        assert!(wiztree.update_url.ends_with("wiztreeversion.php"));
        assert!(!wiztree.fallback_page_url.is_empty());
        assert!(wiztree
            .extra_entries
            .iter()
            .any(|e| e == "locale/zh_CHS/LC_MESSAGES/default.mo"));
        assert_eq!(
            expand_version_template(&wiztree.download_url, "4.32", "").unwrap(),
            "https://diskanalyzer.com/files/wiztree_4_32_portable.zip"
        );
    }

    #[test]
    fn registry_includes_cc_switch_portable() {
        let cc = find_spec("cc-switch").unwrap();
        assert_eq!(cc.version_source, VersionSource::LatestJson);
        assert_eq!(cc.exe_entry, "cc-switch.exe");
        assert!(cc.download_url.contains("{version}"));
        assert!(cc.update_url.ends_with("latest.json"));
        assert!(cc
            .extra_entries
            .iter()
            .any(|e| e.eq_ignore_ascii_case("portable.ini")));
        assert_eq!(
            expand_version_template(&cc.download_url, "3.20.3", "").unwrap(),
            "https://github.com/farion1231/cc-switch/releases/download/v3.20.3/CC-Switch-v3.20.3-Windows-Portable.zip"
        );
    }

    #[test]
    fn version_from_tag_extracts_dot_versions() {
        assert_eq!(version_from_tag("notepad-v3.9.0").as_deref(), Some("3.9.0"));
        assert_eq!(version_from_tag("v1.2.3").as_deref(), Some("1.2.3"));
        assert_eq!(version_from_tag("1.5.4.180").as_deref(), Some("1.5.4.180"));
        assert_eq!(version_from_tag("release-2024.1").as_deref(), Some("2024.1"));
        assert_eq!(version_from_tag("noversion").as_deref(), None);
        assert_eq!(version_from_tag("v").as_deref(), None);
    }

    #[test]
    fn tag_and_version_from_release_url_parses_tag_paths() {
        let pair = tag_and_version_from_release_url(
            "https://github.com/cxasm/notepad--/releases/tag/notepad-v3.9.0",
        )
        .unwrap();
        assert_eq!(pair.0, "notepad-v3.9.0");
        assert_eq!(pair.1, "3.9.0");
        let with_query = tag_and_version_from_release_url(
            "https://github.com/cxasm/notepad--/releases/tag/notepad-v3.9.0?x=1",
        )
        .unwrap();
        assert_eq!(with_query.0, "notepad-v3.9.0");
        assert_eq!(with_query.1, "3.9.0");
        assert_eq!(tag_and_version_from_release_url("https://github.com/x/y"), None);
    }

    #[test]
    fn registry_includes_notepad_portable() {
        let np = find_spec("notepad--").unwrap();
        assert_eq!(np.version_source, VersionSource::RedirectTag);
        assert_eq!(np.exe_entry, "Notepad--.exe");
        assert!(np.extract_all);
        assert!(np.extra_entries.is_empty());
        // 下载地址用真实 tag(而非写死的 tag 前缀)+ 版本号拼装
        assert!(np.download_url.contains("/releases/download/{tag}/"));
        assert!(np.download_url.contains("Notepad--v{version}-win10-portable.zip"));
        assert!(np.update_url.ends_with("/releases/latest"));
        assert_eq!(
            expand_version_template(&np.download_url, "3.9.0", "notepad-v3.9.0").unwrap(),
            "https://github.com/cxasm/notepad--/releases/download/notepad-v3.9.0/Notepad--v3.9.0-win10-portable.zip"
        );
        // 即便作者换了 tag 命名(如 v4.0.0),模板仍能拼出正确地址
        assert_eq!(
            expand_version_template(&np.download_url, "4.0.0", "v4.0.0").unwrap(),
            "https://github.com/cxasm/notepad--/releases/download/v4.0.0/Notepad--v4.0.0-win10-portable.zip"
        );
    }

    #[test]
    fn registry_includes_hiddify_portable() {
        let hf = find_spec("hiddify").unwrap();
        assert_eq!(hf.version_source, VersionSource::RedirectTag);
        assert_eq!(hf.exe_entry, "Hiddify.exe");
        assert!(hf.extract_all);
        assert!(!hf.raw_exe);
        assert!(hf.extra_entries.is_empty());
        // 便携包文件名固定,用真实 tag 拼装下载地址
        assert!(hf.download_url.contains("/releases/download/{tag}/"));
        assert!(hf.download_url.ends_with("Hiddify-Windows-Portable-x64.zip"));
        assert!(hf.update_url.ends_with("/releases/latest"));
        assert_eq!(
            expand_version_template(&hf.download_url, "4.1.1", "v4.1.1").unwrap(),
            "https://github.com/hiddify/hiddify-app/releases/download/v4.1.1/Hiddify-Windows-Portable-x64.zip"
        );
    }

    #[test]
    fn registry_includes_magpie_raw_exe() {
        let mp = find_spec("magpie").unwrap();
        assert_eq!(mp.version_source, VersionSource::RedirectTag);
        assert_eq!(mp.exe_entry, "magpie.exe");
        assert!(mp.raw_exe);
        assert!(!mp.extract_all);
        assert!(mp.download_url.contains("{tag}"));
        assert!(mp.download_url.ends_with("magpie-windows-amd64.exe"));
        assert!(mp.update_url.ends_with("/releases/latest"));
        assert_eq!(
            expand_version_template(&mp.download_url, "0.1.1203", "v0.1.1203").unwrap(),
            "https://github.com/yetone/magpie-releases/releases/download/v0.1.1203/magpie-windows-amd64.exe"
        );
    }

    #[test]
    fn every_tool_group_is_registered() {
        let registered: Vec<&str> = TOOL_GROUPS.iter().map(|(id, _)| *id).collect();
        for spec in registry() {
            assert!(
                registered.contains(&spec.group.as_str()),
                "工具 {} 的分组 {} 未登记在 TOOL_GROUPS,请新增分组或改用已有 id",
                spec.id,
                spec.group
            );
        }
        // 现有工具的预期分组
        for (id, group) in [
            ("geek", "system"),
            ("everything", "system"),
            ("wiztree", "system"),
            ("hiddify", "system"),
            ("gonavi", "database"),
            ("dbx", "database"),
            ("cc-switch", "ai"),
            ("magpie", "ai"),
            ("notepad--", "editor"),
        ] {
            assert_eq!(find_spec(id).unwrap().group, group, "工具 {id} 分组不符");
        }
    }

    #[test]
    fn safe_zip_components_rejects_traversal() {
        assert_eq!(
            safe_zip_components("dir/a/b.txt"),
            Some(vec![
                "dir".to_string(),
                "a".to_string(),
                "b.txt".to_string()
            ])
        );
        assert_eq!(safe_zip_components("normal name/file.txt").is_some(), true);
        assert_eq!(safe_zip_components("../evil.txt"), None);
        assert_eq!(safe_zip_components("dir/../evil.txt"), None);
        assert_eq!(safe_zip_components("/abs.txt"), None);
        assert_eq!(safe_zip_components("C:/abs.txt"), None);
        assert_eq!(safe_zip_components("dir/"), Some(vec!["dir".to_string()]));
        assert_eq!(safe_zip_components(""), None);
    }

    #[test]
    fn strip_common_top_dir_only_when_shared() {
        let shared = [
            vec!["app".to_string(), "a.txt".to_string()],
            vec!["app".to_string(), "sub".to_string(), "b.txt".to_string()],
        ];
        let refs: Vec<&[String]> = shared.iter().map(|v| v.as_slice()).collect();
        assert_eq!(strip_common_top_dir(&refs), 1);

        let mixed = [
            vec!["app".to_string(), "a.txt".to_string()],
            vec!["root.txt".to_string()],
        ];
        let refs2: Vec<&[String]> = mixed.iter().map(|v| v.as_slice()).collect();
        assert_eq!(strip_common_top_dir(&refs2), 0);
        assert_eq!(strip_common_top_dir(&[]), 0);
    }

    #[test]
    fn extract_all_entries_flattens_top_dir_and_finds_exe() {
        let root = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("tools-tests")
            .join("extract-all");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let zip_path = root.join("portable.zip");
        {
            let file = fs::File::create(&zip_path).unwrap();
            let mut writer = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();
            for (name, body) in [
                ("App-v1.2.3-portable/", ""),
                ("App-v1.2.3-portable/App.exe", "exe"),
                ("App-v1.2.3-portable/Qt5Core.dll", "core"),
                ("App-v1.2.3-portable/plugin/lua/a.lua", "lua"),
                ("App-v1.2.3-portable/plugin/pluginlist.json", "list"),
            ] {
                writer.start_file(name, options).unwrap();
                writer.write_all(body.as_bytes()).unwrap();
            }
            writer.finish().unwrap();
        }

        let dest = root.join("install");
        let exe = extract_all_entries(&zip_path, "App.exe", &dest).unwrap();

        assert_eq!(exe, dest.join("App.exe"));
        assert_eq!(fs::read_to_string(dest.join("App.exe")).unwrap(), "exe");
        assert!(dest.join("Qt5Core.dll").exists());
        assert_eq!(
            fs::read_to_string(dest.join("plugin").join("lua").join("a.lua")).unwrap(),
            "lua"
        );
        assert!(dest.join("plugin").join("pluginlist.json").exists());
        // 顶层目录被剥离,不应出现嵌套目录
        assert!(!dest.join("App-v1.2.3-portable").exists());

        // 二次安装(模拟更新):旧目录被清空后重写
        fs::write(dest.join("stale.txt"), "old").unwrap();
        let exe2 = extract_all_entries(&zip_path, "App.exe", &dest).unwrap();
        assert_eq!(exe2, dest.join("App.exe"));
        assert!(!dest.join("stale.txt").exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn extract_entries_keeps_locale_path_and_flattens_plain_entries() {
        let root = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("tools-tests")
            .join("extract-locale");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let zip_path = root.join("portable.zip");
        {
            let file = fs::File::create(&zip_path).unwrap();
            let mut writer = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();
            for (name, body) in [
                ("WizTree64.exe", "exe"),
                ("locale/ar/LC_MESSAGES/default.mo", "ar"),
                ("locale/zh_CHS/LC_MESSAGES/default.mo", "zh"),
                ("license.txt", "license"),
            ] {
                writer.start_file(name, options).unwrap();
                writer.write_all(body.as_bytes()).unwrap();
            }
            writer.finish().unwrap();
        }

        let dest = root.join("install");
        let entries = vec![
            "WizTree64.exe".to_string(),
            "locale/zh_CHS/LC_MESSAGES/default.mo".to_string(),
            "license.txt".to_string(),
        ];
        let exe = extract_entries(&zip_path, &entries, "WizTree64.exe", &dest).unwrap();

        assert_eq!(exe, dest.join("WizTree64.exe"));
        // 语言包保留相对路径,且命中 zh_CHS 而不是压缩包里第一个 default.mo
        let mo = dest
            .join("locale")
            .join("zh_CHS")
            .join("LC_MESSAGES")
            .join("default.mo");
        assert_eq!(fs::read_to_string(&mo).unwrap(), "zh");
        assert!(!dest.join("default.mo").exists());
        assert!(dest.join("license.txt").exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn extract_all_entries_accepts_tar_mislabeled_as_zip() {
        let root = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("tools-tests")
            .join("extract-all-tar");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        // 复刻 Hiddify v4.x 场景: tar 归档被上游命名为 .zip 发布
        let pkg_path = root.join("Hiddify-Windows-Portable-x64.zip");
        {
            let file = fs::File::create(&pkg_path).unwrap();
            let mut builder = tar::Builder::new(file);
            for (name, body) in [
                ("Hiddify/Hiddify.exe", "exe"),
                ("Hiddify/flutter_windows.dll", "core"),
                ("Hiddify/data/flutter_assets/AssetManifest.json", "assets"),
            ] {
                let body = body.as_bytes();
                let mut header = tar::Header::new_gnu();
                header.set_size(body.len() as u64);
                header.set_mode(0o755);
                header.set_cksum();
                builder.append_data(&mut header, name, body).unwrap();
            }
            builder.finish().unwrap();
        }

        let dest = root.join("install");
        let exe = extract_all_entries(&pkg_path, "Hiddify.exe", &dest).unwrap();

        assert_eq!(exe, dest.join("Hiddify.exe"));
        assert_eq!(fs::read_to_string(dest.join("Hiddify.exe")).unwrap(), "exe");
        assert!(dest.join("flutter_windows.dll").exists());
        assert_eq!(
            fs::read_to_string(
                dest.join("data").join("flutter_assets").join("AssetManifest.json")
            )
            .unwrap(),
            "assets"
        );
        // 顶层目录被剥离,不应出现嵌套目录
        assert!(!dest.join("Hiddify").exists());

        // 二次安装(模拟更新):旧目录被清空后重写
        fs::write(dest.join("stale.txt"), "old").unwrap();
        let exe2 = extract_all_entries(&pkg_path, "Hiddify.exe", &dest).unwrap();
        assert_eq!(exe2, dest.join("Hiddify.exe"));
        assert!(!dest.join("stale.txt").exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn detect_pkg_format_by_magic() {
        let root = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("tools-tests")
            .join("detect-format");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let zip_path = root.join("a.zip");
        fs::write(&zip_path, [0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]).unwrap();
        assert_eq!(detect_pkg_format(&zip_path).unwrap(), PkgFormat::Zip);

        let tar_path = root.join("b.tar");
        let mut head = vec![0u8; 512];
        head[257..262].copy_from_slice(b"ustar");
        fs::write(&tar_path, head).unwrap();
        assert_eq!(detect_pkg_format(&tar_path).unwrap(), PkgFormat::Tar);

        // 既非 zip 也非 tar(如下载到的 HTML 错误页)应报错并附文件头
        let html_path = root.join("c.zip");
        fs::write(&html_path, b"<html>Not Found</html>whole lot more than 262 bytes to be safe........").unwrap();
        let err = detect_pkg_format(&html_path).unwrap_err();
        assert!(err.contains("不是有效的 zip 或 tar"), "{err}");

        let _ = fs::remove_dir_all(&root);
    }
}
