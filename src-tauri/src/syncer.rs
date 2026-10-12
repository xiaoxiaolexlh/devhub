use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::manifest;
use crate::settings::APP_TRASH_DIR;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyTask {
    /// Source extension folder absolute path.
    pub source_path: String,
    /// Target editor extensions directory.
    pub target_dir: String,
    /// Folder name to use at the target (usually equals source folder name).
    pub folder_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyResultItem {
    pub source_path: String,
    pub target_path: String,
    pub success: bool,
    pub skipped: bool,
    pub overwritten: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectConfigEntry {
    pub name: String,
    pub path: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectConfigTask {
    pub source_project_dir: String,
    pub target_project_dir: String,
    pub config_dir_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectConfigResultItem {
    pub config_dir_name: String,
    pub source_path: String,
    pub target_path: String,
    pub success: bool,
    pub skipped: bool,
    pub overwritten: bool,
    pub error: Option<String>,
}

pub fn scan_project_config_dirs(project_dir: &str, config_dirs: &[String]) -> Result<Vec<ProjectConfigEntry>, String> {
    let root = PathBuf::from(project_dir);
    if !root.exists() {
        return Err(format!("project directory not found: {project_dir}"));
    }
    if !root.is_dir() {
        return Err(format!("project path is not a directory: {project_dir}"));
    }
    Ok(config_dirs
        .iter()
        .map(|name| {
            let path = root.join(name);
            ProjectConfigEntry {
                name: name.clone(),
                path: path.to_string_lossy().to_string(),
                exists: path.is_dir(),
            }
        })
        .collect())
}

pub fn sync_project_config(task: &ProjectConfigTask, conflict_strategy: &str) -> ProjectConfigResultItem {
    let source_root = PathBuf::from(&task.source_project_dir);
    let target_root = PathBuf::from(&task.target_project_dir);
    let source = source_root.join(&task.config_dir_name);
    let target = target_root.join(&task.config_dir_name);
    let source_str = source.to_string_lossy().to_string();
    let target_str = target.to_string_lossy().to_string();

    if !source_root.is_dir() {
        return project_config_err(&task.config_dir_name, &source_str, &target_str, "source project directory not found");
    }
    if !target_root.is_dir() {
        return project_config_err(&task.config_dir_name, &source_str, &target_str, "target project directory not found");
    }
    if source_root == target_root {
        return project_config_err(&task.config_dir_name, &source_str, &target_str, "source and target project are the same");
    }
    if !source.is_dir() {
        return project_config_err(&task.config_dir_name, &source_str, &target_str, "source config directory not found");
    }

    let mut overwritten = false;
    if target.exists() {
        match conflict_strategy {
            "skip" => {
                return ProjectConfigResultItem {
                    config_dir_name: task.config_dir_name.clone(),
                    source_path: source_str,
                    target_path: target_str,
                    success: true,
                    skipped: true,
                    overwritten: false,
                    error: None,
                };
            }
            _ => {
                let remove_result = if target.is_dir() {
                    fs::remove_dir_all(&target)
                } else {
                    fs::remove_file(&target)
                };
                if let Err(e) = remove_result {
                    return project_config_err(
                        &task.config_dir_name,
                        &source_str,
                        &target_str,
                        &format!("remove old target failed: {e}"),
                    );
                }
                overwritten = true;
            }
        }
    }

    let mut opts = fs_extra::dir::CopyOptions::new();
    opts.copy_inside = true;
    opts.overwrite = true;

    if let Err(e) = fs_extra::dir::copy(&source, &target, &opts) {
        return project_config_err(&task.config_dir_name, &source_str, &target_str, &e.to_string());
    }

    ProjectConfigResultItem {
        config_dir_name: task.config_dir_name.clone(),
        source_path: source_str,
        target_path: target_str,
        success: true,
        skipped: false,
        overwritten,
        error: None,
    }
}

/// Copy a single extension folder according to the conflict strategy.
/// Strategies:
///   - "skip"      : keep existing target folder, do nothing
///   - "overwrite" : remove existing then copy
///   - "ask"       : behave as overwrite (front-end is responsible for asking before invoking)
pub fn copy_extension(task: &CopyTask, conflict_strategy: &str) -> CopyResultItem {
    let source = PathBuf::from(&task.source_path);
    let target_root = PathBuf::from(&task.target_dir);
    let target = target_root.join(&task.folder_name);
    let target_str = target.to_string_lossy().to_string();

    if !source.exists() {
        return err(&task.source_path, &target_str, "source not found");
    }
    if let Err(e) = fs::create_dir_all(&target_root) {
        return err(
            &task.source_path,
            &target_str,
            &format!("create target dir failed: {e}"),
        );
    }

    let mut overwritten = false;
    if target.exists() {
        match conflict_strategy {
            "skip" => {
                return CopyResultItem {
                    source_path: task.source_path.clone(),
                    target_path: target_str,
                    success: true,
                    skipped: true,
                    overwritten: false,
                    error: None,
                };
            }
            _ => {
                if let Err(e) = fs::remove_dir_all(&target) {
                    return err(
                        &task.source_path,
                        &target_str,
                        &format!("remove old target failed: {e}"),
                    );
                }
                overwritten = true;
            }
        }
    }

    let mut opts = fs_extra::dir::CopyOptions::new();
    opts.copy_inside = true;
    opts.overwrite = true;

    if let Err(e) = fs_extra::dir::copy(&source, &target, &opts) {
        return err(&task.source_path, &target_str, &e.to_string());
    }

    // Register the copy in the target editor's extensions.json. Without this,
    // modern VSCode forks (Cursor / Windsurf / Codebuddy / Trae …) will ignore
    // the folder entirely, even though it physically exists.
    let manifest_err: Option<String> = match manifest::read_pkg_id_version(&target) {
        Some((id, version)) => {
            manifest::register_copied(
                &target_root,
                &task.folder_name,
                &id,
                &version,
            )
            .err()
            .map(|e| format!("manifest update failed: {e}"))
        }
        None => Some(
            "manifest update skipped: cannot read package.json (publisher/name/version missing)"
                .to_string(),
        ),
    };

    CopyResultItem {
        source_path: task.source_path.clone(),
        target_path: target_str,
        success: manifest_err.is_none(),
        skipped: false,
        overwritten,
        error: manifest_err,
    }
}

fn err(source: &str, target: &str, msg: &str) -> CopyResultItem {
    CopyResultItem {
        source_path: source.to_string(),
        target_path: target.to_string(),
        success: false,
        skipped: false,
        overwritten: false,
        error: Some(msg.to_string()),
    }
}

fn project_config_err(
    config_dir_name: &str,
    source: &str,
    target: &str,
    msg: &str,
) -> ProjectConfigResultItem {
    ProjectConfigResultItem {
        config_dir_name: config_dir_name.to_string(),
        source_path: source.to_string(),
        target_path: target.to_string(),
        success: false,
        skipped: false,
        overwritten: false,
        error: Some(msg.to_string()),
    }
}

/// Move a folder into the timestamped trash root under `%TEMP%\devhub-trash\`.
/// Falls back to copy + remove when source/target are on different volumes.
/// Also removes the matching entry from the parent editor's extensions.json.
pub fn move_to_trash(path: &Path) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(format!("path not found: {}", path.display()));
    }
    let trash_root = trash_root();
    let dest = trash_root.join(unique_trash_name(&trash_root, path));
    fs::create_dir_all(&trash_root).map_err(|e| e.to_string())?;

    if fs::rename(path, &dest).is_err() {
        // cross-volume rename fails on Windows; fall back to copy + remove
        let mut opts = fs_extra::dir::CopyOptions::new();
        opts.copy_inside = true;
        opts.overwrite = true;
        fs_extra::dir::copy(path, &dest, &opts).map_err(|e| e.to_string())?;
        fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    }

    // Unregister from extensions.json so the editor stops trying to load it.
    if let (Some(parent), Some(folder_name)) = (
        path.parent(),
        path.file_name().and_then(|n| n.to_str()),
    ) {
        // best-effort; trashing already succeeded
        let _ = manifest::unregister(parent, folder_name);
    }

    Ok(dest)
}

fn trash_root() -> PathBuf {
    std::env::temp_dir()
        .join(APP_TRASH_DIR)
        .join(Local::now().format("%Y%m%d").to_string())
}

fn unique_trash_name(root: &Path, src: &Path) -> String {
    let base = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "item".to_string());
    let ts = Local::now().format("%H%M%S").to_string();
    let mut candidate = format!("{}__{}", base, ts);
    let mut idx = 1;
    while root.join(&candidate).exists() {
        candidate = format!("{}__{}_{}", base, ts, idx);
        idx += 1;
    }
    candidate
}

/// Delete trash batches older than `keep_days` days. Best-effort, errors are ignored.
pub fn purge_old_trash(keep_days: u32) {
    let root = std::env::temp_dir().join(APP_TRASH_DIR);
    let Ok(read) = fs::read_dir(&root) else { return };
    let cutoff = Local::now() - chrono::Duration::days(keep_days as i64);
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // batch dir is named YYYYMMDD
        if let Ok(d) = chrono::NaiveDate::parse_from_str(&name, "%Y%m%d") {
            let dt = d
                .and_hms_opt(0, 0, 0)
                .and_then(|n| n.and_local_timezone(Local).single());
            if let Some(dt) = dt {
                if dt < cutoff {
                    let _ = fs::remove_dir_all(entry.path());
                }
            }
        }
    }
}
