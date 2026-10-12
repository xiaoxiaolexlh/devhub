use crate::commands::{
    attach_child_to_managed_job, canonical_project_path, configure_hidden_process,
    decode_process_bytes, kill_process_tree, normalize_input_path, path_to_display_string,
};
use chrono::Local;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Per-task stored output is capped so long-running dev servers don't grow memory forever.
const MAX_STORED_OUTPUT_CHARS: usize = 256 * 1024;

static NODE_TASKS: Lazy<Mutex<HashMap<String, NodeServiceTaskState>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static TASK_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NodeServiceScript {
    pub name: String,
    pub command: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NodeServiceInfo {
    pub package_manager: String,
    pub has_package_json: bool,
    pub has_node_modules: bool,
    pub scripts: Vec<NodeServiceScript>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NodeServiceRunRequest {
    pub service_id: String,
    pub service_path: String,
    pub command: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NodeServiceRunResult {
    pub task_id: String,
    pub command: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NodeServiceTaskState {
    pub task_id: String,
    pub service_id: String,
    pub service_path: String,
    /// "command" for user-entered commands, "http" for the built-in static server.
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
pub struct NodeServiceStopResult {
    pub task_id: String,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NodeServiceLogEvent {
    pub task_id: String,
    pub service_id: String,
    pub stream: String,
    pub line: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NodeServiceExitEvent {
    pub task_id: String,
    pub service_id: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn node_service_read_info(path: String) -> Result<NodeServiceInfo, String> {
    let normalized = normalize_input_path(&path);
    let dir = Path::new(&normalized);
    if !dir.is_dir() {
        return Err(format!("文件夹不存在或不是目录: {path}"));
    }

    let package_json = dir.join("package.json");
    let has_package_json = package_json.is_file();
    let has_node_modules = dir.join("node_modules").is_dir();
    let package_manager = detect_package_manager(dir);

    let mut scripts = Vec::new();
    if has_package_json {
        let content = fs::read_to_string(&package_json)
            .map_err(|e| format!("无法读取 package.json: {e}"))?;
        let value: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| format!("package.json 不是有效 JSON: {e}"))?;
        if let Some(map) = value.get("scripts").and_then(|s| s.as_object()) {
            for (name, script) in map {
                let body = script.as_str().unwrap_or_default().trim().to_string();
                scripts.push(NodeServiceScript {
                    name: name.clone(),
                    command: if body.is_empty() {
                        format!("{package_manager} run {name}")
                    } else {
                        format!("{package_manager} run {name}")
                    },
                });
            }
        }
    }

    Ok(NodeServiceInfo {
        package_manager,
        has_package_json,
        has_node_modules,
        scripts,
    })
}

#[tauri::command]
pub fn node_service_run(
    app: tauri::AppHandle,
    request: NodeServiceRunRequest,
) -> NodeServiceRunResult {
    let command_text = request.command.trim().to_string();
    if command_text.is_empty() {
        return NodeServiceRunResult {
            task_id: String::new(),
            command: String::new(),
            error: Some("命令不能为空".into()),
        };
    }
    let service_path = match canonical_project_path(&request.service_path) {
        Ok(path) => path,
        Err(error) => {
            return NodeServiceRunResult {
                task_id: String::new(),
                command: command_text,
                error: Some(error),
            }
        }
    };
    spawn_service_task(app, request.service_id, service_path, command_text, "command")
}

/// Starts the built-in static file server for a service folder. The server is a
/// regular node task, so logging, stopping and exit cleanup reuse the task pipeline.
/// `allow_lan` binds all interfaces so LAN devices can reach the folder through
/// the Windows firewall prompt etc.; unset/false keeps the loopback-only default.
#[tauri::command]
pub fn node_service_start_http(
    app: tauri::AppHandle,
    service_id: String,
    service_path: String,
    allow_lan: Option<bool>,
) -> NodeServiceRunResult {
    let script_path = match node_http_server_script_path(&app) {
        Ok(path) => path,
        Err(error) => {
            return NodeServiceRunResult {
                task_id: String::new(),
                command: String::new(),
                error: Some(error),
            }
        }
    };
    let service_path = match canonical_project_path(&service_path) {
        Ok(path) => path,
        Err(error) => {
            return NodeServiceRunResult {
                task_id: String::new(),
                command: String::new(),
                error: Some(error),
            }
        }
    };
    // The script path is quoted because the install dir may contain spaces;
    // port 0 lets the OS pick a free port, reported back via the READY line.
    let script_display = path_to_display_string(&script_path);
    let command_text = if allow_lan.unwrap_or(false) {
        format!("node \"{script_display}\" --host 0.0.0.0 --port 0")
    } else {
        format!("node \"{script_display}\" --port 0")
    };
    spawn_service_task(app, service_id, service_path, command_text, "http")
}

fn node_http_server_script_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Dev builds read the script straight from the repo so tweaks take effect
    // without a resource copy; packaged builds load it from the bundle resources.
    #[cfg(debug_assertions)]
    {
        let dev_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("node-http-server.cjs");
        if dev_path.is_file() {
            return Ok(dev_path);
        }
    }
    let bundled_path = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法定位应用资源目录: {error}"))?
        .join("resources")
        .join("node-http-server.cjs");
    if bundled_path.is_file() {
        Ok(bundled_path)
    } else {
        Err(format!(
            "内置 HTTP 服务脚本缺失: {}",
            path_to_display_string(&bundled_path)
        ))
    }
}

fn spawn_service_task(
    app: tauri::AppHandle,
    service_id: String,
    service_path: PathBuf,
    command_text: String,
    kind: &str,
) -> NodeServiceRunResult {
    let task_id = format!(
        "node-task-{}-{}",
        now_millis(),
        TASK_SEQ.fetch_add(1, Ordering::Relaxed)
    );

    #[cfg(windows)]
    let mut command = {
        // /C must be handed the command text verbatim via raw_arg. A normal
        // arg() makes std wrap text that contains spaces/quotes and escape its
        // inner `"` as `\"`; cmd strips the outer wrapping quotes and passes the
        // `\"`-quoted parts to the child verbatim, which node (and any
        // MSVCRT-style argv parser) reads back as literal quote characters,
        // producing mangled paths like `cwd"path"`.
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("cmd");
        command.arg("/C").raw_arg(&command_text);
        command
    };
    #[cfg(not(windows))]
    let mut command = {
        let mut command = Command::new("sh");
        command.arg("-c").arg(&command_text);
        command
    };
    command
        .current_dir(&service_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_hidden_process(&mut command);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return NodeServiceRunResult {
                task_id,
                command: command_text,
                error: Some(format!("启动命令失败: {error}")),
            }
        }
    };
    if let Err(error) = attach_child_to_managed_job(&child) {
        let _ = child.kill();
        let _ = child.wait();
        return NodeServiceRunResult {
            task_id,
            command: command_text,
            error: Some(error),
        };
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let pid = child.id();
    let service_path_display = path_to_display_string(&service_path);
    let state_task_id = task_id.clone();
    let exit_task_id = task_id.clone();
    let spawn_task_id = task_id.clone();

    NODE_TASKS.lock().unwrap().insert(
        task_id.clone(),
        NodeServiceTaskState {
            task_id: task_id.clone(),
            service_id: service_id.clone(),
            service_path: service_path_display,
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
        let task_id = spawn_task_id;
        let stdout_handle = stdout.map(|stream| {
            let app = app.clone();
            let task_id = state_task_id.clone();
            let service_id = service_id.clone();
            std::thread::spawn(move || {
                read_task_stream(app, task_id, service_id, "stdout", stream)
            })
        });
        let stderr_handle = stderr.map(|stream| {
            let app = app.clone();
            let task_id = state_task_id.clone();
            let service_id = service_id.clone();
            std::thread::spawn(move || {
                read_task_stream(app, task_id, service_id, "stderr", stream)
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
        if let Some(task) = NODE_TASKS.lock().unwrap().get_mut(&task_id) {
            task.running = false;
            task.pid = None;
            task.stdout = stdout.clone();
            task.stderr = stderr.clone();
            task.success = Some(success);
            task.exit_code = exit_code;
            task.error = error.clone();
            task.finished_at = Some(now_text());
        }
        let _ = app.emit(
            "node-services-exit",
            NodeServiceExitEvent {
                task_id: exit_task_id,
                service_id,
                success,
                exit_code,
                stdout,
                stderr,
                error,
            },
        );
    });

    NodeServiceRunResult {
        task_id,
        command: command_text,
        error: None,
    }
}

#[tauri::command]
pub fn node_service_list_tasks() -> Vec<NodeServiceTaskState> {
    let mut tasks: Vec<NodeServiceTaskState> = NODE_TASKS
        .lock()
        .unwrap()
        .values()
        .cloned()
        .collect();
    tasks.sort_by(|a, b| a.started_at.cmp(&b.started_at));
    tasks
}

#[tauri::command]
pub fn node_service_stop_task(task_id: String) -> NodeServiceStopResult {
    let pid = NODE_TASKS
        .lock()
        .unwrap()
        .get(&task_id)
        .filter(|task| task.running)
        .and_then(|task| task.pid);
    let Some(pid) = pid else {
        return NodeServiceStopResult {
            task_id,
            success: false,
            error: Some("任务不在运行中".into()),
        };
    };
    match kill_process_tree(pid) {
        Ok(()) => NodeServiceStopResult {
            task_id,
            success: true,
            error: None,
        },
        Err(error) => NodeServiceStopResult {
            task_id,
            success: false,
            error: Some(error),
        },
    }
}

#[tauri::command]
pub fn node_service_stop_service(service_id: String) -> Vec<NodeServiceStopResult> {
    let service_id = service_id.trim().to_string();
    let task_ids: Vec<String> = NODE_TASKS
        .lock()
        .unwrap()
        .values()
        .filter(|task| {
            task.running
                && (service_id.is_empty() || task.service_id == service_id)
        })
        .map(|task| task.task_id.clone())
        .collect();
    task_ids
        .into_iter()
        .map(|task_id| node_service_stop_task(task_id))
        .collect()
}

#[tauri::command]
pub fn node_service_clear_task(task_id: String) -> Result<(), String> {
    let mut tasks = NODE_TASKS.lock().unwrap();
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
    service_id: String,
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
                    "node-services-log",
                    NodeServiceLogEvent {
                        task_id: task_id.clone(),
                        service_id: service_id.clone(),
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
                    "node-services-log",
                    NodeServiceLogEvent {
                        task_id: task_id.clone(),
                        service_id: service_id.clone(),
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
    if let Some(task) = NODE_TASKS.lock().unwrap().get_mut(task_id) {
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

fn detect_package_manager(dir: &Path) -> String {
    if dir.join("pnpm-lock.yaml").is_file() {
        "pnpm".into()
    } else if dir.join("yarn.lock").is_file() {
        "yarn".into()
    } else if dir.join("bun.lockb").is_file() || dir.join("bun.lock").is_file() {
        "bun".into()
    } else {
        "npm".into()
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
