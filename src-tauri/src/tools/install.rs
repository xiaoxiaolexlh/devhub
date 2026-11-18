use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// 先完整解压并验证程序入口,再替换安装目录;用户数据随目录切换保留。
/// 未声明保留目录的工具继续使用原有整包解压流程。
pub(super) fn extract_preserving_dirs(
    package: &Path,
    exe_entry: &str,
    destination: &Path,
    preserved_dirs: &[&str],
) -> Result<PathBuf, String> {
    if preserved_dirs.is_empty() {
        return super::extract_all_entries(package, exe_entry, destination);
    }
    for name in preserved_dirs {
        if !matches!(super::safe_zip_components(name), Some(parts) if parts.len() == 1 && parts[0] == *name)
        {
            return Err(format!("用户数据目录必须是顶层目录名: {name}"));
        }
    }

    let parent = destination.parent().ok_or("工具目录缺少父目录")?;
    let name = destination.file_name().ok_or("工具目录缺少名称")?;
    fs::create_dir_all(parent).map_err(|e| format!("创建工具父目录失败: {e}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let staging_name = format!(
        ".{}-update-{}-{stamp}",
        name.to_string_lossy(),
        std::process::id()
    );
    let staging = parent.join(&staging_name);
    let previous = parent.join(format!("{staging_name}-previous"));
    // create_dir 拒绝复用已有目录,仅清理本次操作拥有的临时目录。
    fs::create_dir(&staging).map_err(|e| format!("创建更新暂存目录失败: {e}"))?;

    let prepared = (|| {
        if previous.try_exists().map_err(|e| e.to_string())? {
            return Err("更新备份目录已存在,请重试".into());
        }
        let exe = super::extract_all_entries(package, exe_entry, &staging)?;
        let relative_exe = exe
            .strip_prefix(&staging)
            .map_err(|e| format!("程序入口不在暂存目录内: {e}"))?
            .to_path_buf();
        let had_previous = destination.try_exists().map_err(|e| e.to_string())?;
        if had_previous {
            fs::rename(destination, &previous)
                .map_err(|e| format!("备份工具目录失败,请确认工具已退出: {e}"))?;
        }
        Ok((relative_exe, had_previous))
    })();
    let (relative_exe, had_previous) = match prepared {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };

    let mut moved_dirs = Vec::new();
    let installed = (|| {
        if had_previous {
            for name in preserved_dirs {
                let source = previous.join(name);
                if !source.try_exists().map_err(|e| e.to_string())? {
                    continue;
                }
                let target = staging.join(name);
                // 丢弃新包的空数据目录,保留旧目录的全部内容。
                if target.try_exists().map_err(|e| e.to_string())? {
                    fs::remove_dir_all(&target)
                        .map_err(|e| format!("移除新包默认数据目录失败: {e}"))?;
                }
                fs::rename(&source, &target)
                    .map_err(|e| format!("保留用户数据目录 {name} 失败: {e}"))?;
                moved_dirs.push(*name);
            }
        }
        fs::rename(&staging, destination).map_err(|e| format!("替换工具目录失败: {e}"))?;
        Ok(destination.join(relative_exe))
    })();

    match installed {
        Ok(exe) => {
            if had_previous {
                let _ = fs::remove_dir_all(&previous);
            }
            Ok(exe)
        }
        Err(error) => {
            let rollback = (|| {
                for name in moved_dirs.iter().rev() {
                    fs::rename(staging.join(name), previous.join(name))
                        .map_err(|e| format!("还原用户数据目录 {name} 失败: {e}"))?;
                }
                if had_previous {
                    fs::rename(&previous, destination)
                        .map_err(|e| format!("还原工具目录失败: {e}"))?;
                }
                Ok::<_, String>(())
            })();
            if let Err(rollback_error) = rollback {
                // 还原失败时保留两处目录,避免删除仍在暂存目录中的用户数据。
                return Err(format!(
                    "{error}; {rollback_error}; 请保留并检查 {} 和 {}",
                    previous.display(),
                    staging.display()
                ));
            }
            let _ = fs::remove_dir_all(&staging);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("target/tools-tests")
                .join(format!("nyaterm-{name}-{}-{stamp}", std::process::id()));
            fs::create_dir_all(&root).unwrap();
            Self(root)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let allowed = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/tools-tests");
            let resolved = self.0.canonicalize().unwrap();
            assert!(resolved.starts_with(allowed.canonicalize().unwrap()));
            let _ = fs::remove_dir_all(resolved);
        }
    }

    fn package(path: &Path, entries: &[(&str, &[u8])]) {
        let mut writer = zip::ZipWriter::new(fs::File::create(path).unwrap());
        for (name, body) in entries {
            writer
                .start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(body).unwrap();
        }
        writer.finish().unwrap();
    }

    fn install_nyaterm(package: &Path, destination: &Path) -> Result<PathBuf, String> {
        let spec = super::super::find_managed_spec("nyaterm").unwrap();
        extract_preserving_dirs(package, &spec.exe_entry, destination, spec.preserved_dirs)
    }

    #[test]
    fn nyaterm_install_and_update_preserves_connections_and_keys() {
        let root = TestDir::new("update");
        let archive = root.0.join("portable.zip");
        package(
            &archive,
            &[
                ("NyaTerm-portable/NyaTerm.exe", b"new-program"),
                ("NyaTerm-portable/nyaterm-portable", b""),
                ("NyaTerm-portable/nyaterm-rdp-helper.exe", b"rdp"),
                ("NyaTerm-portable/conpty/x64/conpty.dll", b"pty"),
                ("NyaTerm-portable/data/.keep", b""),
            ],
        );
        let destination = root.0.join("install");
        assert_eq!(
            install_nyaterm(&archive, &destination).unwrap(),
            destination.join("NyaTerm.exe")
        );
        assert!(destination.join("nyaterm-portable").exists());
        assert!(destination.join("nyaterm-rdp-helper.exe").exists());
        assert!(destination.join("conpty/x64/conpty.dll").exists());
        assert!(destination.join("data/.keep").exists());
        fs::create_dir_all(destination.join("data/keys")).unwrap();
        fs::write(destination.join("data/keys/id_ed25519"), b"private-key").unwrap();
        fs::write(
            destination.join("data/connections.db"),
            b"saved-connections",
        )
        .unwrap();
        fs::write(destination.join("stale.dll"), b"old-library").unwrap();
        fs::write(destination.join("NyaTerm.exe"), b"old-program").unwrap();

        install_nyaterm(&archive, &destination).unwrap();
        assert_eq!(
            fs::read(destination.join("NyaTerm.exe")).unwrap(),
            b"new-program"
        );
        assert_eq!(
            fs::read(destination.join("data/connections.db")).unwrap(),
            b"saved-connections"
        );
        assert_eq!(
            fs::read(destination.join("data/keys/id_ed25519")).unwrap(),
            b"private-key"
        );
        assert!(!destination.join("stale.dll").exists());
        assert!(destination.join("nyaterm-portable").is_file());
        assert!(!destination.join("NyaTerm-portable").is_dir());
        assert_eq!(fs::read_dir(&root.0).unwrap().count(), 2);
    }

    #[test]
    fn invalid_package_keeps_previous_program_and_data() {
        let root = TestDir::new("invalid");
        let destination = root.0.join("install");
        fs::create_dir_all(destination.join("data")).unwrap();
        fs::write(destination.join("NyaTerm.exe"), b"old-program").unwrap();
        fs::write(
            destination.join("data/connections.db"),
            b"saved-connections",
        )
        .unwrap();
        let archive = root.0.join("portable.zip");
        fs::write(&archive, b"<html>Not Found</html>").unwrap();
        assert!(install_nyaterm(&archive, &destination).is_err());
        package(
            &archive,
            &[("NyaTerm-portable/other.exe", b"wrong-program")],
        );
        assert!(install_nyaterm(&archive, &destination).is_err());
        assert_eq!(
            fs::read(destination.join("NyaTerm.exe")).unwrap(),
            b"old-program"
        );
        assert_eq!(
            fs::read(destination.join("data/connections.db")).unwrap(),
            b"saved-connections"
        );
        assert_eq!(fs::read_dir(&root.0).unwrap().count(), 2);
    }

    #[test]
    fn failed_data_move_restores_previous_installation() {
        let root = TestDir::new("rollback");
        let destination = root.0.join("install");
        fs::create_dir_all(destination.join("data")).unwrap();
        fs::write(destination.join("NyaTerm.exe"), b"old-program").unwrap();
        fs::write(
            destination.join("data/connections.db"),
            b"saved-connections",
        )
        .unwrap();
        let archive = root.0.join("portable.zip");
        // 新包错误地把数据目录打包为普通文件,替换失败后必须还原。
        package(
            &archive,
            &[
                ("NyaTerm-portable/NyaTerm.exe", b"new-program"),
                ("NyaTerm-portable/data", b"not-a-directory"),
            ],
        );
        assert!(install_nyaterm(&archive, &destination).is_err());
        assert_eq!(
            fs::read(destination.join("NyaTerm.exe")).unwrap(),
            b"old-program"
        );
        assert_eq!(
            fs::read(destination.join("data/connections.db")).unwrap(),
            b"saved-connections"
        );
        assert_eq!(fs::read_dir(&root.0).unwrap().count(), 2);
    }

    #[test]
    #[ignore = "requires the official portable ZIP in DEVHUB_NYATERM_PACKAGE"]
    fn official_nyaterm_portable_installs_and_preserves_data() {
        let archive = PathBuf::from(std::env::var_os("DEVHUB_NYATERM_PACKAGE").unwrap());
        let root = TestDir::new("official");
        let destination = root.0.join("install");
        install_nyaterm(&archive, &destination).unwrap();
        for entry in [
            "NyaTerm.exe",
            "nyaterm-portable",
            "nyaterm-rdp-helper.exe",
            "nyaterm-vnc-helper.exe",
            "conpty/x64/conpty.dll",
            "avcodec-62.dll",
            "data/.keep",
        ] {
            assert!(destination.join(entry).exists(), "missing {entry}");
        }
        fs::write(destination.join("data/verification.txt"), b"saved-data").unwrap();
        install_nyaterm(&archive, &destination).unwrap();
        assert_eq!(
            fs::read(destination.join("data/verification.txt")).unwrap(),
            b"saved-data"
        );
    }
}
