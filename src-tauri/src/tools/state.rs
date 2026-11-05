use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ToolState {
    pub version: String,
    pub exe_path: String,
    pub installed_at: String,
    pub last_checked: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolsState {
    // 仅文件不存在表示首次使用;存在的文件必须具有 tools 字段。
    pub tools: BTreeMap<String, ToolState>,
}

const LOCK_TIMEOUT: Duration = Duration::from_secs(5);
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(super) fn load(path: &Path) -> Result<ToolsState, String> {
    read_state(path).map(|(state, _)| state)
}

fn read_state(path: &Path) -> Result<(ToolsState, Option<Vec<u8>>), String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok((ToolsState::default(), None));
        }
        Err(error) => {
            return Err(format!(
                "无法读取工具安装记录 {}: {error}。未清空记录,请检查文件和访问权限后刷新。",
                path.display()
            ));
        }
    };
    // 兼容用户用 Windows 编辑器修复文件后保存的 UTF-8 BOM。
    let json = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes);
    let state = serde_json::from_slice(json).map_err(|error| {
        format!(
            "工具安装记录损坏 {}: {error}。已保留原文件,请勿重新下载;请退出 DevHub,备份并修复该文件,或检查备份 {} 后恢复,再刷新。",
            path.display(),
            path.with_extension("json.bak").display()
        )
    })?;
    Ok((state, Some(bytes)))
}

/// edit 返回 false 时不写文件。锁覆盖读取、合并、备份、替换的整个事务。
/// 独立锁文件不随状态文件替换而变化;由操作系统释放,进程异常退出也不会留下死锁。
pub(super) fn update(
    path: &Path,
    edit: impl FnOnce(&mut ToolsState) -> bool,
) -> Result<ToolsState, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "工具安装记录路径无效".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("无法创建工具数据目录: {e}"))?;
    let _lock = acquire_lock(path, LOCK_TIMEOUT)?;
    let (mut state, previous) = read_state(path)?;
    if !edit(&mut state) {
        return Ok(state);
    }
    let json = serde_json::to_vec_pretty(&state).map_err(|e| e.to_string())?;
    // 只备份已成功解析的上一版;损坏文件不会覆盖有效备份。
    if let Some(previous) = previous {
        let backup = path.with_extension("json.bak");
        atomic_write(&backup, &previous).map_err(|e| {
            format!(
                "无法备份工具安装记录 {}: {e}。原记录未替换。",
                backup.display()
            )
        })?;
    }
    atomic_write(path, &json).map_err(|e| {
        format!(
            "无法保存工具安装记录 {}: {e}。未删除原记录,请重试。",
            path.display()
        )
    })?;
    Ok(state)
}

fn acquire_lock(path: &Path, timeout: Duration) -> Result<File, String> {
    let lock_path = path.with_extension("json.lock");
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .map_err(|e| format!("无法打开工具安装记录锁 {}: {e}", lock_path.display()))?;
    let started = Instant::now();
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(TryLockError::WouldBlock) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(TryLockError::WouldBlock) => {
                return Err("工具安装记录正被其它任务或 DevHub 实例使用,请稍后重试。".into());
            }
            Err(TryLockError::Error(error)) => {
                return Err(format!(
                    "无法锁定工具安装记录 {}: {error}",
                    lock_path.display()
                ));
            }
        }
    }
}

/// 临时文件与目标处于同一目录,create_new 防止不同进程或遗留临时文件相互覆盖。
/// 替换失败只清理本次临时文件,绝不先删除目标文件。
fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let (temp, mut file) = loop {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let name = path
            .file_name()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing state filename"))?;
        let mut temp_name = name.to_os_string();
        temp_name.push(format!(".{}.{sequence}.tmp", std::process::id()));
        let temp = path.with_file_name(temp_name);
        match OpenOptions::new().write(true).create_new(true).open(&temp) {
            Ok(file) => break (temp, file),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    };
    let result = (|| {
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command;
    use std::sync::{Arc, Barrier};

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let root = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("target/tools-state-tests")
                .join(format!("{}-{sequence}", std::process::id()));
            fs::create_dir_all(&root).unwrap();
            Self(root)
        }

        fn path(&self) -> PathBuf {
            self.0.join("tools.json")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let allowed = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/tools-state-tests");
            let target = self.0.canonicalize().unwrap();
            let allowed = allowed.canonicalize().unwrap();
            assert!(target.starts_with(&allowed) && target != allowed);
            let _ = fs::remove_dir_all(target);
        }
    }

    fn insert(path: &Path, id: &str) {
        update(path, |state| {
            state.tools.insert(
                id.into(),
                ToolState {
                    version: "1.0.0".into(),
                    exe_path: format!("C:\\tools\\{id}\\{id}.exe"),
                    installed_at: "2026-11-05T09:28:00+08:00".into(),
                    last_checked: "0".into(),
                },
            );
            true
        })
        .unwrap();
    }

    #[test]
    fn only_missing_file_is_empty_state() {
        let f = Fixture::new();
        assert!(load(&f.path()).unwrap().tools.is_empty());
        assert!(!f.path().exists());
        fs::write(f.path(), br#"{"tools":{}}"#).unwrap();
        assert!(load(&f.path()).unwrap().tools.is_empty());
        fs::remove_file(f.path()).unwrap();
        fs::create_dir(f.path()).unwrap();
        assert!(load(&f.path()).unwrap_err().contains("无法读取"));
    }

    #[test]
    fn corrupt_state_is_preserved_and_never_overwrites_backup() {
        for bad in [
            br#"{"tools":{}}{}"#.as_slice(),
            b"",
            br#"{"tools":"#,
            b"{}",
            b"[]",
            &[0xff],
        ] {
            let f = Fixture::new();
            let backup = f.path().with_extension("json.bak");
            let good = br#"{"tools":{"argus":{"version":"0.3.4"}}}"#;
            fs::write(&backup, good).unwrap();
            fs::write(f.path(), bad).unwrap();
            let error = load(&f.path()).unwrap_err();
            assert!(error.contains("工具安装记录损坏"));
            assert!(error.contains(&f.path().display().to_string()));
            let result = update(&f.path(), |_| panic!("must not edit corrupt state"));
            assert!(result.is_err());
            assert_eq!(fs::read(f.path()).unwrap(), bad);
            assert_eq!(fs::read(backup).unwrap(), good);
        }
    }

    #[test]
    fn roundtrip_preserves_fields_and_previous_valid_backup() {
        let f = Fixture::new();
        insert(&f.path(), "argus");
        let previous = fs::read(f.path()).unwrap();
        insert(&f.path(), "magpie");
        let state = load(&f.path()).unwrap();
        assert_eq!(state.tools.len(), 2);
        assert_eq!(state.tools["argus"].version, "1.0.0");
        assert_eq!(state.tools["argus"].exe_path, "C:\\tools\\argus\\argus.exe");
        assert_eq!(
            fs::read(f.path().with_extension("json.bak")).unwrap(),
            previous
        );
        let json: serde_json::Value = serde_json::from_slice(&previous).unwrap();
        assert!(json["tools"]["argus"].get("installedAt").is_some());
        assert!(json["tools"]["argus"].get("lastChecked").is_some());
    }

    #[test]
    fn shorter_replacement_does_not_leave_trailing_bytes() {
        let f = Fixture::new();
        insert(&f.path(), "argus");
        update(&f.path(), |state| {
            state.tools.clear();
            true
        })
        .unwrap();
        assert!(load(&f.path()).unwrap().tools.is_empty());
        let json: serde_json::Value = serde_json::from_slice(&fs::read(f.path()).unwrap()).unwrap();
        assert_eq!(json, serde_json::json!({"tools": {}}));
    }

    #[test]
    fn bom_is_accepted_after_manual_repair() {
        let f = Fixture::new();
        fs::write(f.path(), b"\xef\xbb\xbf{\"tools\":{}}").unwrap();
        assert!(load(&f.path()).unwrap().tools.is_empty());
    }

    #[test]
    fn unchanged_update_does_not_create_state_or_backup() {
        let f = Fixture::new();
        update(&f.path(), |_| false).unwrap();
        assert!(!f.path().exists());
        insert(&f.path(), "argus");
        let before = fs::read(f.path()).unwrap();
        update(&f.path(), |_| false).unwrap();
        assert_eq!(fs::read(f.path()).unwrap(), before);
        assert!(!f.path().with_extension("json.bak").exists());
    }

    #[test]
    fn backup_failure_preserves_original_and_cleans_temporary_file() {
        let f = Fixture::new();
        insert(&f.path(), "argus");
        let before = fs::read(f.path()).unwrap();
        let backup = f.path().with_extension("json.bak");
        fs::create_dir(&backup).unwrap();
        let error = update(&f.path(), |state| {
            state.tools.clear();
            true
        })
        .unwrap_err();
        assert!(error.contains("无法备份"));
        assert_eq!(fs::read(f.path()).unwrap(), before);
        assert!(!fs::read_dir(&f.0).unwrap().any(|e| e
            .unwrap()
            .path()
            .extension()
            .is_some_and(|e| e == "tmp")));
    }

    #[cfg(windows)]
    #[test]
    fn replacement_failure_never_deletes_original() {
        use std::os::windows::fs::OpenOptionsExt;
        let f = Fixture::new();
        insert(&f.path(), "argus");
        let before = fs::read(f.path()).unwrap();
        // 允许读取但不允许删除/替换,模拟其它程序持有不共享删除的句柄。
        let held = OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(f.path())
            .unwrap();
        let error = update(&f.path(), |state| {
            state.tools.clear();
            true
        })
        .unwrap_err();
        assert!(error.contains("无法保存"));
        assert_eq!(fs::read(f.path()).unwrap(), before);
        assert!(!fs::read_dir(&f.0).unwrap().any(|e| e
            .unwrap()
            .path()
            .extension()
            .is_some_and(|e| e == "tmp")));
        drop(held);
        insert(&f.path(), "magpie");
        assert_eq!(load(&f.path()).unwrap().tools.len(), 2);
    }

    #[test]
    fn lock_timeout_is_reported_and_released_on_drop() {
        let f = Fixture::new();
        let held = acquire_lock(&f.path(), Duration::ZERO).unwrap();
        assert!(acquire_lock(&f.path(), Duration::from_millis(30))
            .unwrap_err()
            .contains("其它任务"));
        drop(held);
        assert!(acquire_lock(&f.path(), Duration::ZERO).is_ok());
    }

    #[test]
    fn concurrent_downloads_and_checks_keep_every_update() {
        let f = Fixture::new();
        insert(&f.path(), "counter");
        let barrier = Arc::new(Barrier::new(8));
        let threads: Vec<_> = (0..8)
            .map(|i| {
                let barrier = Arc::clone(&barrier);
                let path = f.path();
                std::thread::spawn(move || {
                    barrier.wait();
                    for _ in 0..8 {
                        update(&path, |state| {
                            let counter = state.tools.get_mut("counter").unwrap();
                            counter.last_checked =
                                (counter.last_checked.parse::<u32>().unwrap() + 1).to_string();
                            state
                                .tools
                                .insert(format!("tool-{i}"), ToolState::default());
                            true
                        })
                        .unwrap();
                        assert!(load(&path).unwrap().tools.contains_key("counter"));
                    }
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        let state = load(&f.path()).unwrap();
        assert_eq!(state.tools.len(), 9);
        assert_eq!(state.tools["counter"].last_checked, "64");
    }

    #[test]
    fn separate_processes_merge_instead_of_overwriting() {
        let f = Fixture::new();
        insert(&f.path(), "counter");
        let mut children: Vec<_> = (0..4)
            .map(|i| {
                Command::new(std::env::current_exe().unwrap())
                    .args([
                        "--exact",
                        "tools::state::tests::process_update_worker",
                        "--ignored",
                    ])
                    .env("DEVHUB_STATE_TEST_FILE", f.path())
                    .env("DEVHUB_STATE_TEST_ID", i.to_string())
                    .spawn()
                    .unwrap()
            })
            .collect();
        for child in &mut children {
            assert!(child.wait().unwrap().success());
        }
        let state = load(&f.path()).unwrap();
        assert_eq!(state.tools.len(), 5);
        assert_eq!(state.tools["counter"].last_checked, "32");
    }

    #[test]
    #[ignore = "child process of separate_processes_merge_instead_of_overwriting"]
    fn process_update_worker() {
        let path = PathBuf::from(std::env::var_os("DEVHUB_STATE_TEST_FILE").unwrap());
        let allowed = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/tools-state-tests");
        assert!(path.starts_with(allowed));
        let id = std::env::var("DEVHUB_STATE_TEST_ID").unwrap();
        for _ in 0..8 {
            update(&path, |state| {
                let counter = state.tools.get_mut("counter").unwrap();
                counter.last_checked =
                    (counter.last_checked.parse::<u32>().unwrap() + 1).to_string();
                std::thread::sleep(Duration::from_millis(2));
                state
                    .tools
                    .insert(format!("process-{id}"), ToolState::default());
                true
            })
            .unwrap();
        }
    }
}
