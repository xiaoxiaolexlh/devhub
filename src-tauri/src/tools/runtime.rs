use serde::Serialize;
use std::path::Path;
use std::time::{Duration, Instant};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolProcessInfo {
    pub pid: u32,
    pub name: String,
    pub exe_path: String,
}

fn path_key(path: &Path) -> String {
    let resolved = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    normalize_path_key(&resolved.to_string_lossy())
}

fn normalize_path_key(path: &str) -> String {
    let key = path.replace('/', "\\").to_lowercase();
    let key = if let Some(unc) = key.strip_prefix("\\\\?\\unc\\") {
        format!("\\\\{unc}")
    } else {
        key.strip_prefix("\\\\?\\").unwrap_or(&key).to_string()
    };
    key.trim_end_matches('\\').to_string()
}

fn is_tool_exe(exe_key: &str, dir_key: &str) -> bool {
    !dir_key.is_empty()
        && exe_key
            .strip_prefix(dir_key)
            .is_some_and(|rest| rest.starts_with('\\'))
}

/// Match the managed directory, including helper executables and all instances.
/// Names alone must never select another installation of the same application.
pub fn running_processes(install_dir: &Path) -> Vec<ToolProcessInfo> {
    let dir_key = path_key(install_dir);
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::new().with_exe(UpdateKind::Always),
    );
    let mut processes: Vec<_> = system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            let exe = process.exe()?;
            is_tool_exe(&path_key(exe), &dir_key).then(|| ToolProcessInfo {
                pid: pid.as_u32(),
                name: process.name().to_string_lossy().to_string(),
                exe_path: exe.to_string_lossy().to_string(),
            })
        })
        .collect();
    processes.sort_by_key(|process| process.pid);
    processes
}

pub fn close_running_tool(install_dir: &Path) -> Result<(), String> {
    let processes = running_processes(install_dir);
    if processes.is_empty() {
        return Ok(());
    }
    request_close(&processes)?;
    wait_until_stopped(
        || running_processes(install_dir).is_empty(),
        Duration::from_secs(15),
    )
}

fn wait_until_stopped(mut stopped: impl FnMut() -> bool, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    loop {
        if stopped() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err("工具尚未退出，已停止更新。请处理保存提示、结束正在执行的任务，或从托盘退出程序后重试。".into());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

#[cfg(windows)]
fn request_close(processes: &[ToolProcessInfo]) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindow, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, GW_OWNER,
        WM_CLOSE,
    };

    struct Windows<'a> {
        processes: &'a [ToolProcessInfo],
        handles: Vec<HWND>,
    }
    unsafe extern "system" fn collect(hwnd: HWND, data: LPARAM) -> BOOL {
        let windows = &mut *(data as *mut Windows<'_>);
        if IsWindowVisible(hwnd) != 0 && GetWindow(hwnd, GW_OWNER).is_null() {
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if windows.processes.iter().any(|process| process.pid == pid) {
                windows.handles.push(hwnd);
            }
        }
        1
    }
    let mut windows = Windows {
        processes,
        handles: Vec::new(),
    };
    if unsafe { EnumWindows(Some(collect), &mut windows as *mut Windows<'_> as LPARAM) } == 0 {
        return Err(format!(
            "无法检查工具窗口，已停止更新: {}",
            std::io::Error::last_os_error()
        ));
    }
    // Sending WM_CLOSE lets the application save/ask/cancel and clean up itself.
    // Never terminate a process or its tree, including windowless helpers.
    for hwnd in windows.handles {
        let mut pid = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut pid);
        }
        let Some(expected) = processes.iter().find(|process| process.pid == pid) else {
            continue;
        };
        // Revalidate the executable before addressing a possibly reused PID/window.
        let mut system = System::new();
        let process_pid = sysinfo::Pid::from_u32(pid);
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[process_pid]),
            true,
            ProcessRefreshKind::new().with_exe(UpdateKind::Always),
        );
        if system
            .process(process_pid)
            .and_then(|process| process.exe())
            .is_some_and(|exe| path_key(exe) == path_key(Path::new(&expected.exe_path)))
            && unsafe { PostMessageW(hwnd, WM_CLOSE, 0, 0) } == 0
        {
            return Err(format!(
                "无法请求工具正常关闭，已停止更新。请手动退出后重试: {}",
                std::io::Error::last_os_error()
            ));
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn request_close(_processes: &[ToolProcessInfo]) -> Result<(), String> {
    Err("请手动退出工具后重试更新".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directory_matching_includes_helpers_but_excludes_other_installations() {
        let dir = path_key(Path::new("D:/managed/tools/editor"));
        for exe in [
            "d:/managed/tools/editor/app.exe",
            "D:/managed/tools/editor/bin/helper.exe",
        ] {
            assert!(is_tool_exe(&path_key(Path::new(exe)), &dir));
        }
        for exe in [
            "D:/other/editor/app.exe",
            "D:/managed/tools/editor-other/app.exe",
            "D:/managed/tools/editor.exe",
        ] {
            assert!(!is_tool_exe(&path_key(Path::new(exe)), &dir));
        }
        assert!(!is_tool_exe("app.exe", ""));
    }

    #[test]
    fn extended_windows_paths_match_regular_paths() {
        assert_eq!(
            normalize_path_key(r"\\?\D:\managed\app"),
            normalize_path_key("d:/managed/app")
        );
        assert_eq!(
            normalize_path_key(r"\\?\UNC\server\share\app"),
            normalize_path_key(r"\\server\share\app")
        );
    }

    #[test]
    fn a_close_request_only_succeeds_after_every_process_exits() {
        let mut checks = 0;
        wait_until_stopped(
            || {
                checks += 1;
                checks == 2
            },
            Duration::from_secs(1),
        )
        .unwrap();
        assert_eq!(checks, 2);
        let error = wait_until_stopped(|| false, Duration::ZERO).unwrap_err();
        assert!(error.contains("已停止更新"));
        assert!(error.contains("保存提示"));
        wait_until_stopped(|| true, Duration::ZERO).unwrap();
    }

    #[test]
    fn backend_guard_reports_a_real_running_process_before_any_replacement() {
        let exe = std::env::current_exe().unwrap();
        let processes = running_processes(exe.parent().unwrap());
        assert!(processes
            .iter()
            .any(|process| process.pid == std::process::id()));
        let error = super::super::require_tool_stopped(exe.parent().unwrap()).unwrap_err();
        let json = serde_json::to_value(error).unwrap();
        assert_eq!(json["kind"], "running");
        assert!(json["processes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|process| process["pid"] == std::process::id()));
    }

    #[cfg(windows)]
    #[test]
    fn normal_close_exits_a_real_window_and_a_canceled_close_times_out() {
        use std::os::windows::process::CommandExt;
        use std::process::{Child, Command, Stdio};
        struct Probe(Child);
        impl Drop for Probe {
            fn drop(&mut self) {
                // This is only the copied test fixture inside the workspace.
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        for mode in ["accept", "cancel"] {
            let root = std::env::current_dir()
                .unwrap()
                .join("target/tools-runtime-tests")
                .join(format!("{}-{mode}", std::process::id()));
            std::fs::create_dir_all(&root).unwrap();
            let exe = root.join("window-probe.exe");
            std::fs::copy(std::env::current_exe().unwrap(), &exe).unwrap();
            let mut probe = Probe(
                Command::new(&exe)
                    .args([
                        "--exact",
                        "tools::runtime::tests::runtime_window_probe",
                        "--ignored",
                    ])
                    .env("DEVHUB_TOOL_RUNTIME_PROBE", mode)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .creation_flags(0x08000000)
                    .spawn()
                    .unwrap(),
            );
            let ready = root.join("ready");
            let deadline = Instant::now() + Duration::from_secs(10);
            while !ready.exists() {
                assert!(
                    probe.0.try_wait().unwrap().is_none(),
                    "window probe exited before readiness"
                );
                assert!(
                    Instant::now() < deadline,
                    "window probe failed to become ready"
                );
                std::thread::sleep(Duration::from_millis(20));
            }
            let processes = running_processes(&root);
            assert_eq!(processes.len(), 1);
            assert_eq!(processes[0].pid, probe.0.id());
            request_close(&processes).unwrap();
            if mode == "accept" {
                wait_until_stopped(
                    || running_processes(&root).is_empty(),
                    Duration::from_secs(5),
                )
                .unwrap();
                assert!(probe.0.wait().unwrap().success());
            } else {
                assert!(wait_until_stopped(
                    || running_processes(&root).is_empty(),
                    Duration::from_millis(300)
                )
                .is_err());
                assert!(
                    probe.0.try_wait().unwrap().is_none(),
                    "a canceled close must leave the process alive"
                );
                assert!(super::super::require_tool_stopped(&root).is_err());
            }
            drop(probe);
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "child fixture launched only by the real-window test"]
    fn runtime_window_probe() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, IsWindow,
            PeekMessageW, TranslateMessage, MSG, PM_REMOVE, WM_CLOSE, WS_OVERLAPPEDWINDOW,
            WS_VISIBLE,
        };
        let exe = std::env::current_exe().unwrap();
        assert_eq!(exe.file_name().unwrap(), "window-probe.exe");
        let mode = std::env::var("DEVHUB_TOOL_RUNTIME_PROBE").unwrap();
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let title: Vec<u16> = "DevHub update test\0".encode_utf16().collect();
        unsafe {
            // A visible but offscreen fixture; never interacts with the user's windows.
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                title.as_ptr(),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                -32000,
                -32000,
                20,
                20,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            );
            assert!(!hwnd.is_null());
            std::fs::write(exe.parent().unwrap().join("ready"), b"ready").unwrap();
            let deadline = Instant::now() + Duration::from_secs(20);
            while IsWindow(hwnd) != 0 && Instant::now() < deadline {
                let mut message: MSG = std::mem::zeroed();
                while PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                    if message.message == WM_CLOSE && mode == "cancel" {
                        continue;
                    }
                    if message.message == WM_CLOSE {
                        DefWindowProcW(
                            message.hwnd,
                            message.message,
                            message.wParam,
                            message.lParam,
                        );
                    } else {
                        TranslateMessage(&message);
                        DispatchMessageW(&message);
                    }
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            if IsWindow(hwnd) != 0 {
                DestroyWindow(hwnd);
            }
        }
    }
}
