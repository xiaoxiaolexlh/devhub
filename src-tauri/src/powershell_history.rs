use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_HOST_HISTORY: &str = "ConsoleHost_history.txt";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerShellHistoryFile {
    id: String,
    shell: String,
    file_name: String,
    path: String,
    exists: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerShellHistoryDocument {
    file: PowerShellHistoryFile,
    commands: Vec<String>,
    revision: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerShellHistorySaveResult {
    document: PowerShellHistoryDocument,
    backup_path: Option<String>,
}

fn history_roots(app_data: &Path) -> [(&'static str, &'static str, PathBuf); 1] {
    [(
        "windows-psreadline",
        "PowerShell / PSReadLine",
        app_data.join("Microsoft/Windows/PowerShell/PSReadLine"),
    )]
}

fn app_data_dir() -> Result<PathBuf, String> {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "未找到当前 Windows 用户的 APPDATA 目录。".to_string())
}

fn resolve_history_path(file_id: &str) -> Result<(String, String, PathBuf), String> {
    let (root_key, file_name) = file_id
        .split_once('/')
        .ok_or_else(|| "PowerShell 历史文件标识无效。".to_string())?;
    if Path::new(file_name)
        .file_name()
        .and_then(|name| name.to_str())
        != Some(file_name)
        || file_name.contains(':')
        || !file_name.to_ascii_lowercase().ends_with("_history.txt")
    {
        return Err("只能管理 PSReadLine 的 *_history.txt 文件。".to_string());
    }

    let app_data = app_data_dir()?;
    let (shell, root) = history_roots(&app_data)
        .into_iter()
        .find_map(|(key, shell, root)| (key == root_key).then_some((shell, root)))
        .ok_or_else(|| "不支持的 PowerShell 历史目录。".to_string())?;
    let path = root.join(file_name);
    if fs::symlink_metadata(&path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("为避免修改目录之外的文件，不支持符号链接历史文件。".to_string());
    }
    Ok((shell.to_string(), file_name.to_string(), path))
}

fn describe_file(file_id: &str) -> Result<PowerShellHistoryFile, String> {
    let (shell, file_name, path) = resolve_history_path(file_id)?;
    Ok(PowerShellHistoryFile {
        id: file_id.to_string(),
        shell,
        file_name,
        exists: path.is_file(),
        path: path.to_string_lossy().into_owned(),
    })
}

fn revision(bytes: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn parse_history(bytes: &[u8]) -> Result<Vec<String>, String> {
    let text_bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    let text = std::str::from_utf8(text_bytes)
        .map_err(|_| "历史文件不是有效的 UTF-8 文本，已停止以避免破坏内容。".to_string())?;
    if text.is_empty() {
        return Ok(Vec::new());
    }

    let mut commands = Vec::new();
    let mut current = String::new();
    for physical_line in text.split_terminator('\n') {
        let line = physical_line.strip_suffix('\r').unwrap_or(physical_line);
        if let Some(continued) = line.strip_suffix('`') {
            current.push_str(continued);
            current.push('\n');
        } else {
            current.push_str(line);
            commands.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        commands.push(current);
    }
    Ok(commands)
}

fn encode_history(commands: &[String], previous: &[u8]) -> Result<Vec<u8>, String> {
    let has_bom = previous.starts_with(&[0xEF, 0xBB, 0xBF]);
    let line_ending = if previous.windows(2).any(|pair| pair == b"\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut text = String::new();
    for command in commands {
        if command.contains('\0') {
            return Err("命令内容包含无效的空字符。".to_string());
        }
        let normalized = command.replace("\r\n", "\n").replace('\r', "\n");
        text.push_str(&normalized.replace('\n', &format!("`{line_ending}")));
        text.push_str(line_ending);
    }

    let mut bytes = Vec::with_capacity(text.len() + usize::from(has_bom) * 3);
    if has_bom {
        bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    bytes.extend_from_slice(text.as_bytes());
    Ok(bytes)
}

#[tauri::command]
pub fn powershell_history_list() -> Result<Vec<PowerShellHistoryFile>, String> {
    let app_data = app_data_dir()?;
    let mut files = Vec::new();
    for (root_key, shell, root) in history_roots(&app_data) {
        let mut names = Vec::<String>::new();
        match fs::read_dir(&root) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    if !entry
                        .file_type()
                        .map(|kind| kind.is_file())
                        .unwrap_or(false)
                    {
                        continue;
                    }
                    let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                        continue;
                    };
                    if name.to_ascii_lowercase().ends_with("_history.txt") {
                        names.push(name);
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("无法读取 PSReadLine 历史目录：{error}")),
        }
        if !names
            .iter()
            .any(|name| name.eq_ignore_ascii_case(DEFAULT_HOST_HISTORY))
        {
            names.push(DEFAULT_HOST_HISTORY.to_string());
        }
        names.sort_by_key(|name| name.to_ascii_lowercase());
        names.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
        for file_name in names {
            let id = format!("{root_key}/{file_name}");
            let path = root.join(&file_name);
            files.push(PowerShellHistoryFile {
                id,
                shell: shell.to_string(),
                file_name,
                exists: path.is_file(),
                path: path.to_string_lossy().into_owned(),
            });
        }
    }
    Ok(files)
}

#[tauri::command]
pub fn powershell_history_read(file_id: String) -> Result<PowerShellHistoryDocument, String> {
    let file = describe_file(&file_id)?;
    let path = PathBuf::from(&file.path);
    let bytes = match fs::read(&path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("无法读取 PowerShell 历史：{error}")),
    };
    let commands = bytes
        .as_deref()
        .map(parse_history)
        .transpose()?
        .unwrap_or_default();
    let file_revision = bytes.as_deref().map(revision);
    Ok(PowerShellHistoryDocument {
        file,
        commands,
        revision: file_revision,
    })
}

#[tauri::command]
pub fn powershell_history_save(
    file_id: String,
    commands: Vec<String>,
    expected_revision: Option<String>,
) -> Result<PowerShellHistorySaveResult, String> {
    let (shell, file_name, path) = resolve_history_path(&file_id)?;
    let previous = match fs::read(&path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("无法读取待保存的 PowerShell 历史：{error}")),
    };
    let current_revision = previous.as_deref().map(revision);
    if current_revision != expected_revision {
        return Err("历史文件已被 PowerShell 或其他程序修改，请刷新后再保存。".to_string());
    }

    let previous_bytes = previous.as_deref().unwrap_or_default();
    let next_bytes = encode_history(&commands, previous_bytes)?;
    let next_revision = revision(&next_bytes);
    let mut backup_path = None;
    if previous.is_some() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos();
        let backup = path.with_file_name(format!("{file_name}.{stamp}.bak"));
        fs::copy(&path, &backup).map_err(|error| format!("创建历史备份失败：{error}"))?;
        backup_path = Some(backup.to_string_lossy().into_owned());
    }

    let parent = path
        .parent()
        .ok_or_else(|| "PowerShell 历史路径无效。".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建 PSReadLine 历史目录：{error}"))?;
    fs::write(&path, next_bytes).map_err(|error| {
        format!(
            "写入 PowerShell 历史失败{}：{error}",
            backup_path
                .as_ref()
                .map(|backup| format!("；原始文件备份在 {backup}"))
                .unwrap_or_default()
        )
    })?;

    let file = PowerShellHistoryFile {
        id: file_id,
        shell,
        file_name,
        path: path.to_string_lossy().into_owned(),
        exists: true,
    };
    Ok(PowerShellHistorySaveResult {
        document: PowerShellHistoryDocument {
            file,
            commands,
            revision: Some(next_revision),
        },
        backup_path,
    })
}

#[cfg(test)]
mod tests {
    use super::{encode_history, parse_history, resolve_history_path, revision};

    #[test]
    fn rejects_alternate_data_stream_file_names() {
        assert!(resolve_history_path(
            "windows-psreadline/ConsoleHost_history.txt:stream_history.txt"
        )
        .is_err());
    }

    #[test]
    fn parses_and_serializes_multiline_commands_and_crlf() {
        let original = b"Get-ChildItem\r\nWrite-Output `\r\n  'hello'\r\n";
        let commands = parse_history(original).expect("parse history");
        assert_eq!(commands, ["Get-ChildItem", "Write-Output \n  'hello'"]);
        let serialized = encode_history(&commands, original).expect("serialize history");
        assert_eq!(serialized, original);
        assert_eq!(
            parse_history(b"first\n\nlast\n").unwrap(),
            ["first", "", "last"]
        );
        assert!(parse_history(b"invalid \xFF utf8").is_err());
    }

    #[test]
    fn preserves_utf8_bom_and_detects_external_edits() {
        let original = b"\xEF\xBB\xBFGet-Location\r\n";
        let commands = parse_history(original).expect("parse history");
        let serialized = encode_history(&commands, original).expect("serialize history");
        assert_eq!(serialized, original);
        assert_ne!(revision(original), revision(b"Get-Location\r\n"));
    }

    #[test]
    fn serializes_added_commands_and_empty_history() {
        assert_eq!(
            encode_history(&["Get-Date".to_string()], b"").expect("serialize"),
            b"Get-Date\n"
        );
        assert_eq!(encode_history(&[], b"old\r\n").expect("clear"), b"");
    }
}
