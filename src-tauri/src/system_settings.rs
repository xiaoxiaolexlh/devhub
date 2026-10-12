/// 系统设置模式:集中提供电脑常用设置与快捷电源操作。
///
/// 关闭显示器通过广播 `WM_SYSCOMMAND(SC_MONITORPOWER, 2)` 实现,等同系统
/// 电源菜单中的「关闭显示器」;移动鼠标或按任意键即可唤醒。
/// 用 PostMessage 而非 SendMessage,避免某个顶层窗口无响应时命令被挂起。
///
/// Windows 已知文件夹(Known Folders):桌面、文档、下载、音乐、图片、视频等
/// 具有特殊功能的用户文件夹。其路径记录在注册表
/// `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders`
/// (REG_EXPAND_SZ,可含环境变量)与 `...\Shell Folders`(REG_SZ,已展开)中。
/// 修改这两个键的对应值,再广播 WM_SETTINGCHANGE 并调用 SHChangeNotify,
/// 即可让系统与资源管理器改用新路径,无需重启或注销。

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct KnownFolder {
    pub id: String,
    pub label: String,
    pub description: String,
    pub current_path: Option<String>,
    pub default_path: Option<String>,
    pub is_default: bool,
}

#[derive(Serialize)]
pub struct SetKnownFolderResult {
    pub id: String,
    pub new_path: String,
    pub moved_files: u64,
    pub skipped_files: u64,
}

#[cfg(windows)]
struct KnownFolderDef {
    id: &'static str,
    label: &'static str,
    description: &'static str,
    /// 注册表值名称(User Shell Folders / Shell Folders 通用)。
    reg_value: &'static str,
    /// %USERPROFILE% 下的默认子目录名。
    default_subdir: &'static str,
    /// 读取当前已解析路径(底层调用 SHGetKnownFolderPath)。
    read: fn() -> Option<PathBuf>,
}

#[cfg(windows)]
const KNOWN_FOLDERS: &[KnownFolderDef] = &[
    KnownFolderDef {
        id: "desktop",
        label: "桌面",
        description: "桌面上显示的文件、文件夹与快捷方式。",
        reg_value: "Desktop",
        default_subdir: "Desktop",
        read: dirs::desktop_dir,
    },
    KnownFolderDef {
        id: "documents",
        label: "文档",
        description: "文档、表格等个人文件的默认保存位置。",
        reg_value: "Personal",
        default_subdir: "Documents",
        read: dirs::document_dir,
    },
    KnownFolderDef {
        id: "downloads",
        label: "下载",
        description: "浏览器、下载器等程序的默认下载位置。",
        reg_value: "{374DE290-123F-4565-9164-39C4925E467B}",
        default_subdir: "Downloads",
        read: dirs::download_dir,
    },
    KnownFolderDef {
        id: "music",
        label: "音乐",
        description: "音乐文件的默认保存位置。",
        reg_value: "My Music",
        default_subdir: "Music",
        read: dirs::audio_dir,
    },
    KnownFolderDef {
        id: "pictures",
        label: "图片",
        description: "图片文件的默认保存位置。",
        reg_value: "My Pictures",
        default_subdir: "Pictures",
        read: dirs::picture_dir,
    },
    KnownFolderDef {
        id: "videos",
        label: "视频",
        description: "视频文件的默认保存位置。",
        reg_value: "My Video",
        default_subdir: "Videos",
        read: dirs::video_dir,
    },
];

#[cfg(windows)]
const USER_SHELL_FOLDERS: &str =
    "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders";
#[cfg(windows)]
const SHELL_FOLDERS: &str =
    "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders";

#[tauri::command]
pub fn system_turn_off_display() -> Result<(), String> {
    turn_off_display()
}

#[tauri::command]
pub fn system_list_known_folders() -> Result<Vec<KnownFolder>, String> {
    list_known_folders()
}

#[tauri::command]
pub fn system_set_known_folder(
    id: String,
    new_path: String,
    move_files: bool,
) -> Result<SetKnownFolderResult, String> {
    set_known_folder(&id, &new_path, move_files)
}

#[tauri::command]
pub fn system_restore_known_folder(
    id: String,
    move_files: bool,
) -> Result<SetKnownFolderResult, String> {
    restore_known_folder(&id, move_files)
}

// ---------------------------------------------------------------------------
// 关闭显示器
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn turn_off_display() -> Result<(), String> {
    use windows_sys::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::PostMessageW;

    const WM_SYSCOMMAND: u32 = 0x0112;
    const SC_MONITORPOWER: WPARAM = 0xF170;
    const MONITOR_POWER_OFF: LPARAM = 2;
    // HWND_BROADCAST = 0xffff,广播给所有顶层窗口
    const HWND_BROADCAST: HWND = 0xffff as HWND;

    let ok = unsafe {
        PostMessageW(HWND_BROADCAST, WM_SYSCOMMAND, SC_MONITORPOWER, MONITOR_POWER_OFF)
    };
    if ok == 0 {
        return Err(format!(
            "发送关闭显示器消息失败: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn turn_off_display() -> Result<(), String> {
    Err("关闭显示器功能仅支持 Windows".into())
}

// ---------------------------------------------------------------------------
// 已知文件夹管理
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn list_known_folders() -> Result<Vec<KnownFolder>, String> {
    let home = dirs::home_dir();
    Ok(KNOWN_FOLDERS
        .iter()
        .map(|def| {
            let current_path = (def.read)().map(|p| path_to_string(&p));
            let default_path = home
                .as_ref()
                .map(|h| path_to_string(&h.join(def.default_subdir)));
            let is_default = match (&current_path, &default_path) {
                (Some(c), Some(d)) => same_path(c, d),
                _ => false,
            };
            KnownFolder {
                id: def.id.to_string(),
                label: def.label.to_string(),
                description: def.description.to_string(),
                current_path,
                default_path,
                is_default,
            }
        })
        .collect())
}

#[cfg(windows)]
fn set_known_folder(
    id: &str,
    new_path: &str,
    move_files: bool,
) -> Result<SetKnownFolderResult, String> {
    let def = KNOWN_FOLDERS
        .iter()
        .find(|d| d.id == id)
        .ok_or_else(|| format!("未知的系统文件夹: {id}"))?;

    let target = PathBuf::from(new_path);
    validate_path(&target)?;

    let old_path = (def.read)();
    std::fs::create_dir_all(&target).map_err(|e| format!("创建目标文件夹失败: {e}"))?;

    // 自定义路径直接写绝对值;User Shell Folders 用 REG_EXPAND_SZ,
    // Shell Folders 用 REG_SZ(已展开)。两处保持一致。
    write_shell_folder_registry(def.reg_value, new_path, new_path)?;

    broadcast_setting_change();
    notify_shell();

    let (moved, skipped) = if move_files {
        if let Some(old) = old_path.as_ref() {
            move_folder_contents(old, &target)
        } else {
            (0, 0)
        }
    } else {
        (0, 0)
    };

    Ok(SetKnownFolderResult {
        id: id.to_string(),
        new_path: new_path.to_string(),
        moved_files: moved,
        skipped_files: skipped,
    })
}

#[cfg(windows)]
fn restore_known_folder(
    id: &str,
    move_files: bool,
) -> Result<SetKnownFolderResult, String> {
    let def = KNOWN_FOLDERS
        .iter()
        .find(|d| d.id == id)
        .ok_or_else(|| format!("未知的系统文件夹: {id}"))?;

    let home = dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?;
    let expanded = home.join(def.default_subdir);
    let expandable = format!("%USERPROFILE%\\{}", def.default_subdir);

    let old_path = (def.read)();
    std::fs::create_dir_all(&expanded).map_err(|e| format!("创建默认文件夹失败: {e}"))?;

    // 恢复默认:User Shell Folders 写回含环境变量的原始形式,
    // Shell Folders 写已展开的绝对路径。
    write_shell_folder_registry(
        def.reg_value,
        &expandable,
        &path_to_string(&expanded),
    )?;

    broadcast_setting_change();
    notify_shell();

    let (moved, skipped) = if move_files {
        if let Some(old) = old_path.as_ref() {
            move_folder_contents(old, &expanded)
        } else {
            (0, 0)
        }
    } else {
        (0, 0)
    };

    Ok(SetKnownFolderResult {
        id: id.to_string(),
        new_path: path_to_string(&expanded),
        moved_files: moved,
        skipped_files: skipped,
    })
}

#[cfg(not(windows))]
fn list_known_folders() -> Result<Vec<KnownFolder>, String> {
    Err("系统文件夹管理仅支持 Windows".into())
}

#[cfg(not(windows))]
fn set_known_folder(_: &str, _: &str, _: bool) -> Result<SetKnownFolderResult, String> {
    Err("系统文件夹管理仅支持 Windows".into())
}

#[cfg(not(windows))]
fn restore_known_folder(_: &str, _: bool) -> Result<SetKnownFolderResult, String> {
    Err("系统文件夹管理仅支持 Windows".into())
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn path_to_string(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

#[cfg(windows)]
fn same_path(a: &str, b: &str) -> bool {
    let pa = Path::new(a);
    let pb = Path::new(b);
    if let (Ok(ca), Ok(cb)) = (std::fs::canonicalize(pa), std::fs::canonicalize(pb)) {
        return ca == cb;
    }
    // 退化为大小写不敏感、分隔符归一化的字符串比较。
    let norm = |s: &str| s.replace('/', "\\").to_lowercase();
    norm(a) == norm(b)
}

#[cfg(windows)]
fn validate_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("目标路径必须是绝对路径".into());
    }
    if path.file_name().is_none() {
        return Err("不能将系统文件夹设为驱动器根目录(如 C:\\)".into());
    }
    Ok(())
}

/// 将字符串编码为以 null 结尾的 UTF-16,用于注册表宽字符 API。
#[cfg(windows)]
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0u16)).collect()
}

/// 同时写入 User Shell Folders(REG_EXPAND_SZ)与 Shell Folders(REG_SZ)。
#[cfg(windows)]
fn write_shell_folder_registry(
    value_name: &str,
    user_shell_value: &str,
    shell_folders_value: &str,
) -> Result<(), String> {
    use windows_sys::Win32::System::Registry::{
        REG_EXPAND_SZ, REG_SZ,
    };

    set_reg_value(USER_SHELL_FOLDERS, value_name, user_shell_value, REG_EXPAND_SZ)?;
    set_reg_value(SHELL_FOLDERS, value_name, shell_folders_value, REG_SZ)?;
    Ok(())
}

/// 在 HKCU 下打开(必要时创建)指定子键并写入一个字符串值。
#[cfg(windows)]
fn set_reg_value(
    subkey: &str,
    value_name: &str,
    data: &str,
    ty: windows_sys::Win32::System::Registry::REG_VALUE_TYPE,
) -> Result<(), String> {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
        REG_OPTION_NON_VOLATILE,
    };

    let subkey_w = wide(subkey);
    let name_w = wide(value_name);
    let data_w = wide(data);
    let byte_len = (data_w.len() * 2) as u32;

    let mut hkey: HKEY = core::ptr::null_mut();
    let result = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            subkey_w.as_ptr(),
            0,
            core::ptr::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            core::ptr::null(),
            &mut hkey,
            core::ptr::null_mut(),
        )
    };
    if result != 0 {
        return Err(format!(
            "打开注册表键失败 ({subkey}): {}",
            std::io::Error::from_raw_os_error(result as i32)
        ));
    }
    let result = unsafe {
        RegSetValueExW(hkey, name_w.as_ptr(), 0, ty, data_w.as_ptr() as *const u8, byte_len)
    };
    unsafe { RegCloseKey(hkey) };
    if result != 0 {
        return Err(format!(
            "写入注册表值失败 ({value_name}): {}",
            std::io::Error::from_raw_os_error(result as i32)
        ));
    }
    Ok(())
}

/// 广播 WM_SETTINGCHANGE,通知已运行的应用重新读取 Shell Folders。
#[cfg(windows)]
fn broadcast_setting_change() {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::SendMessageTimeoutW;

    const WM_SETTINGCHANGE: u32 = 0x001A;
    const SMTO_ABORTIFHUNG: u32 = 0x0002;
    const HWND_BROADCAST: HWND = 0xffff as HWND;

    let section = wide("User Shell Folders");
    let mut result: usize = 0;
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0usize,
            section.as_ptr() as isize,
            SMTO_ABORTIFHUNG,
            1000,
            &mut result,
        );
    }
}

/// 通知资源管理器刷新 Shell 命名空间,使新路径立即生效。
#[cfg(windows)]
fn notify_shell() {
    use windows_sys::Win32::UI::Shell::SHChangeNotify;

    const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
    const SHCNF_IDLIST: u32 = 0;
    unsafe {
        SHChangeNotify(
            SHCNE_ASSOCCHANGED,
            SHCNF_IDLIST,
            core::ptr::null(),
            core::ptr::null(),
        );
    }
}

/// 把 src 下的顶层文件/文件夹移动到 dst,跳过目标已存在的同名项。
#[cfg(windows)]
fn move_folder_contents(src: &Path, dst: &Path) -> (u64, u64) {
    let mut moved = 0u64;
    let mut skipped = 0u64;
    let entries = match std::fs::read_dir(src) {
        Ok(e) => e,
        Err(_) => return (0, 0),
    };
    for entry in entries.flatten() {
        let from = entry.path();
        let name = entry.file_name();
        let to = dst.join(&name);
        if to.exists() {
            skipped += 1;
            continue;
        }
        if move_item(&from, &to) {
            moved += 1;
        } else {
            skipped += 1;
        }
    }
    (moved, skipped)
}

#[cfg(windows)]
fn move_item(from: &Path, to: &Path) -> bool {
    // 同盘 rename 直接成功。
    if std::fs::rename(from, to).is_ok() {
        return true;
    }
    // 跨盘 rename 失败:改为递归复制后删除原项。
    let res = if from.is_dir() {
        copy_dir_recursive(from, to)
    } else {
        std::fs::copy(from, to).map(|_| ())
    };
    match res {
        Ok(()) => {
            if from.is_dir() {
                let _ = std::fs::remove_dir_all(from);
            } else {
                let _ = std::fs::remove_file(from);
            }
            true
        }
        Err(_) => false,
    }
}

#[cfg(windows)]
fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name();
        let dest = dst.join(&name);
        if path.is_dir() {
            copy_dir_recursive(&path, &dest)?;
        } else {
            std::fs::copy(&path, &dest)?;
        }
    }
    Ok(())
}
