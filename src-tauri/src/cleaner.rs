use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::settings::APP_DATA_DIR;

const ACTION_CLEAR: &str = "clear";
const ACTION_REMOVE: &str = "remove";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CleanerConfig {
    pub profiles: BTreeMap<String, Profile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub description: String,
    pub allowed_actions: Vec<String>,
    pub default_action: String,
    pub directories: Vec<DirectoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryEntry {
    pub path: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPayload {
    pub config_path: String,
    pub config: CleanerConfig,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathPreview {
    pub label: String,
    pub path: String,
    pub absolute_path: String,
    pub exists: bool,
    pub is_dir: bool,
    pub is_file: bool,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanResult {
    pub label: String,
    pub path: String,
    pub absolute_path: String,
    pub action: String,
    pub status: String,
    pub message: String,
}

#[tauri::command]
pub fn cleaner_load_config() -> Result<ConfigPayload, String> {
    ensure_config_file()?;
    let config = read_main_config()?;
    Ok(payload(config))
}

#[tauri::command]
pub fn cleaner_save_config(config: CleanerConfig) -> Result<ConfigPayload, String> {
    let value = serde_json::to_value(config).map_err(|e| e.to_string())?;
    let config = normalize_config_value(value)?;
    write_main_config(&config)?;
    Ok(payload(config))
}

#[tauri::command]
pub fn cleaner_import_config(source_path: String) -> Result<ConfigPayload, String> {
    let source = PathBuf::from(normalize_input_path(source_path.trim()));
    let content = fs::read_to_string(&source)
        .map_err(|e| format!("无法读取配置文件 {}: {e}", path_to_display_string(&source)))?;
    let value: Value = serde_json::from_str(&content).map_err(|e| format!("JSON 格式无效: {e}"))?;
    let config = normalize_config_value(value)?;
    write_main_config(&config)?;
    Ok(payload(config))
}

#[tauri::command]
pub fn cleaner_export_config(destination_path: String) -> Result<(), String> {
    let config = read_main_config()?;
    let destination = PathBuf::from(normalize_input_path(destination_path.trim()));
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    write_config_file(&destination, &config)
}

#[tauri::command]
pub fn cleaner_path_status(path: String) -> Result<PathPreview, String> {
    Ok(build_path_status("", &path))
}

#[tauri::command]
pub fn cleaner_preview_profile(
    profile_key: String,
    action: String,
) -> Result<Vec<PathPreview>, String> {
    let config = read_main_config()?;
    let profile = profile_for_action(&config, &profile_key, &action)?;
    Ok(profile
        .directories
        .iter()
        .map(|entry| build_preview(&entry.label, &entry.path, &action))
        .collect())
}

#[tauri::command]
pub fn cleaner_execute_profile(
    profile_key: String,
    action: String,
) -> Result<Vec<CleanResult>, String> {
    let config = read_main_config()?;
    let profile = profile_for_action(&config, &profile_key, &action)?;
    Ok(profile
        .directories
        .iter()
        .map(|entry| execute_entry(entry, &action))
        .collect())
}

fn config_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(APP_DATA_DIR)
        .join("cleaner")
}

fn config_path() -> PathBuf {
    config_dir().join("cleaner.config.json")
}

fn ensure_config_file() -> Result<(), String> {
    let dir = config_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = config_path();
    if !path.exists() {
        write_config_file(&path, &CleanerConfig::default())?;
    }
    Ok(())
}

fn read_main_config() -> Result<CleanerConfig, String> {
    ensure_config_file()?;
    let path = config_path();
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let value: Value =
        serde_json::from_str(&content).map_err(|e| format!("配置文件 JSON 格式无效: {e}"))?;
    normalize_config_value(value)
}

fn write_main_config(config: &CleanerConfig) -> Result<(), String> {
    ensure_config_file()?;
    write_config_file(&config_path(), config)
}

fn write_config_file(path: &Path, config: &CleanerConfig) -> Result<(), String> {
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    match fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(_) if path.exists() => {
            fs::remove_file(path).map_err(|e| e.to_string())?;
            fs::rename(&tmp, path).map_err(|e| e.to_string())
        }
        Err(e) => Err(e.to_string()),
    }
}

fn payload(config: CleanerConfig) -> ConfigPayload {
    ConfigPayload {
        config_path: path_to_display_string(&config_path()),
        config,
    }
}

fn normalize_config_value(value: Value) -> Result<CleanerConfig, String> {
    let root = value
        .as_object()
        .ok_or_else(|| "配置根节点必须是 object".to_string())?;
    let profiles_value = root
        .get("profiles")
        .ok_or_else(|| "配置缺少 profiles".to_string())?;
    let profiles_object = profiles_value
        .as_object()
        .ok_or_else(|| "profiles 必须是 object".to_string())?;

    let mut profiles = BTreeMap::new();
    for (key, value) in profiles_object {
        let key = key.trim();
        if key.is_empty() {
            return Err("profile key 不能为空".into());
        }
        let object = value.as_object();
        let description = object
            .and_then(|item| item.get("description"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let allowed_actions = normalize_allowed_actions(
            object
                .and_then(|item| item.get("allowedActions"))
                .or_else(|| object.and_then(|item| item.get("allowed_actions"))),
        );
        let default_action = object
            .and_then(|item| item.get("defaultAction"))
            .or_else(|| object.and_then(|item| item.get("default_action")))
            .and_then(Value::as_str)
            .filter(|action| allowed_actions.iter().any(|allowed| allowed == action))
            .unwrap_or(&allowed_actions[0])
            .to_string();
        let directories = normalize_directories(object.and_then(|item| item.get("directories")));
        profiles.insert(
            key.to_string(),
            Profile {
                description,
                allowed_actions,
                default_action,
                directories,
            },
        );
    }
    Ok(CleanerConfig { profiles })
}

fn normalize_allowed_actions(value: Option<&Value>) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(items) = value.and_then(Value::as_array) {
        for item in items {
            let Some(action) = item.as_str() else {
                continue;
            };
            if matches!(action, ACTION_CLEAR | ACTION_REMOVE)
                && !out.iter().any(|existing| existing == action)
            {
                out.push(action.to_string());
            }
        }
    }
    if out.is_empty() {
        out.push(ACTION_CLEAR.to_string());
    }
    out
}

fn normalize_directories(value: Option<&Value>) -> Vec<DirectoryEntry> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            if let Some(path) = item.as_str() {
                return directory_entry(path, "");
            }
            let object = item.as_object()?;
            let path = object
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let label = object
                .get("label")
                .and_then(Value::as_str)
                .unwrap_or_default();
            directory_entry(path, label)
        })
        .collect()
}

fn directory_entry(path: &str, label: &str) -> Option<DirectoryEntry> {
    let path = path.trim();
    if path.is_empty() {
        return None;
    }
    Some(DirectoryEntry {
        path: normalize_input_path(path),
        label: label.to_string(),
    })
}

fn profile_for_action<'a>(
    config: &'a CleanerConfig,
    profile_key: &str,
    action: &str,
) -> Result<&'a Profile, String> {
    let profile = config
        .profiles
        .get(profile_key)
        .ok_or_else(|| format!("profile 不存在: {profile_key}"))?;
    if !matches!(action, ACTION_CLEAR | ACTION_REMOVE) {
        return Err(format!("不支持的清理动作: {action}"));
    }
    if !profile
        .allowed_actions
        .iter()
        .any(|allowed| allowed == action)
    {
        return Err(format!("profile {profile_key} 不允许执行 {action}"));
    }
    Ok(profile)
}

fn build_preview(label: &str, path: &str, action: &str) -> PathPreview {
    let mut preview = build_path_status(label, path);
    if preview.exists && preview.status != "error" && action == ACTION_CLEAR && !preview.is_dir {
        preview.status = "error".into();
        preview.message = "clear 只能用于目录".into();
    }
    preview
}

fn build_path_status(label: &str, path: &str) -> PathPreview {
    let absolute = resolve_target_path(path);
    let absolute_path = path_to_display_string(&absolute);
    match fs::symlink_metadata(&absolute) {
        Ok(metadata) => {
            let file_type = metadata.file_type();
            let is_dir = metadata.is_dir();
            let is_file = metadata.is_file();
            let is_link = file_type.is_symlink();
            let (status, message) = if let Err(error) = validate_target_safety(&absolute) {
                ("error", error)
            } else if is_link {
                ("ready", "目标存在，是符号链接".to_string())
            } else if is_dir {
                ("ready", "目标存在，是目录".to_string())
            } else if is_file {
                ("ready", "目标存在，是文件".to_string())
            } else {
                ("ready", "目标存在".to_string())
            };
            PathPreview {
                label: label.to_string(),
                path: path.to_string(),
                absolute_path,
                exists: true,
                is_dir,
                is_file,
                status: status.to_string(),
                message,
            }
        }
        Err(_) => PathPreview {
            label: label.to_string(),
            path: path.to_string(),
            absolute_path,
            exists: false,
            is_dir: false,
            is_file: false,
            status: "missing".into(),
            message: "目标不存在，已跳过".into(),
        },
    }
}

fn execute_entry(entry: &DirectoryEntry, action: &str) -> CleanResult {
    let absolute = resolve_target_path(&entry.path);
    let absolute_path = path_to_display_string(&absolute);
    let mut result = CleanResult {
        label: entry.label.clone(),
        path: entry.path.clone(),
        absolute_path,
        action: action.to_string(),
        status: "error".into(),
        message: String::new(),
    };

    let metadata = match fs::symlink_metadata(&absolute) {
        Ok(metadata) => metadata,
        Err(_) => {
            result.status = "skipped".into();
            result.message = "目标不存在，已跳过".into();
            return result;
        }
    };

    if let Err(error) = validate_target_safety(&absolute) {
        result.message = error;
        return result;
    }

    let operation = match action {
        ACTION_CLEAR => clear_target(&absolute, &metadata),
        ACTION_REMOVE => remove_target(&absolute, &metadata),
        _ => Err(format!("不支持的清理动作: {action}")),
    };

    match operation {
        Ok(message) => {
            result.status = "success".into();
            result.message = message;
        }
        Err(error) => {
            result.status = "error".into();
            result.message = error;
        }
    }
    result
}

fn clear_target(path: &Path, metadata: &fs::Metadata) -> Result<String, String> {
    if !metadata.is_dir() {
        return Err("clear 只能用于目录".into());
    }
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        remove_path_entry(&entry.path())?;
    }
    Ok("已清空目录".into())
}

fn remove_target(path: &Path, _metadata: &fs::Metadata) -> Result<String, String> {
    remove_path_entry(path)?;
    Ok("已删除目标".into())
}

fn remove_path_entry(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        return remove_link_entry(path);
    }
    if metadata.is_dir() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())
    }
}

fn remove_link_entry(path: &Path) -> Result<(), String> {
    fs::remove_file(path)
        .or_else(|_| fs::remove_dir(path))
        .map_err(|e| e.to_string())
}

fn resolve_target_path(input: &str) -> PathBuf {
    let normalized = normalize_input_path(input.trim());
    let path = PathBuf::from(&normalized);
    if path.is_absolute() {
        path
    } else {
        config_dir().join(path)
    }
}

fn validate_target_safety(path: &Path) -> Result<(), String> {
    if is_filesystem_root(path) {
        return Err("拒绝清理磁盘根目录".into());
    }

    let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    if paths_equal(&canonical, &config_dir()) {
        return Err("拒绝清理 cleaner 配置目录本身".into());
    }

    for protected in protected_exact_paths() {
        if paths_equal(&canonical, &protected) {
            return Err(format!(
                "拒绝清理受保护目录: {}",
                path_to_display_string(&protected)
            ));
        }
    }
    Ok(())
}

fn protected_exact_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for key in [
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "TEMP",
        "TMP",
        "SystemRoot",
        "ProgramFiles",
        "ProgramFiles(x86)",
    ] {
        if let Some(value) = std::env::var_os(key) {
            out.push(PathBuf::from(value));
        }
    }
    out
}

fn paths_equal(a: &Path, b: &Path) -> bool {
    if cfg!(windows) {
        path_to_display_string(a).to_lowercase() == path_to_display_string(b).to_lowercase()
    } else {
        a == b
    }
}

fn is_filesystem_root(path: &Path) -> bool {
    let mut components = path.components();
    match (components.next(), components.next(), components.next()) {
        (Some(Component::Prefix(_)), Some(Component::RootDir), None) => true,
        (Some(Component::RootDir), None, None) => true,
        _ => false,
    }
}

fn normalize_input_path(path: &str) -> String {
    if cfg!(windows) {
        path.replace('/', "\\")
    } else {
        path.to_string()
    }
}

fn path_to_display_string(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();
    if cfg!(windows) {
        if let Some(stripped) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{stripped}");
        }
        if let Some(stripped) = value.strip_prefix(r"\\?\") {
            return stripped.to_string();
        }
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_legacy_directory_strings_and_actions() {
        let value = serde_json::json!({
            "profiles": {
                "a": {
                    "description": "清理",
                    "allowedActions": ["clear", "remove", "bad", "clear"],
                    "defaultAction": "bad",
                    "directories": [
                        "D:/cache/a",
                        { "path": " D:/logs/a ", "label": "日志" },
                        { "path": "   ", "label": "empty" }
                    ]
                }
            }
        });

        let config = normalize_config_value(value).unwrap();
        let profile = config.profiles.get("a").unwrap();
        assert_eq!(profile.allowed_actions, vec!["clear", "remove"]);
        assert_eq!(profile.default_action, "clear");
        assert_eq!(profile.directories.len(), 2);
        assert_eq!(profile.directories[0].label, "");
        assert_eq!(profile.directories[1].label, "日志");
    }

    #[test]
    fn clear_keeps_target_directory() {
        let root = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("cleaner-tests")
            .join("clear-keeps-target");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("child")).unwrap();
        fs::write(root.join("child").join("a.txt"), "a").unwrap();
        fs::write(root.join("b.txt"), "b").unwrap();

        let metadata = fs::symlink_metadata(&root).unwrap();
        clear_target(&root, &metadata).unwrap();

        assert!(root.exists());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remove_deletes_file() {
        let root = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("cleaner-tests")
            .join("remove-file");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let file = root.join("a.txt");
        fs::write(&file, "a").unwrap();

        let metadata = fs::symlink_metadata(&file).unwrap();
        remove_target(&file, &metadata).unwrap();

        assert!(!file.exists());
        let _ = fs::remove_dir_all(&root);
    }
}
