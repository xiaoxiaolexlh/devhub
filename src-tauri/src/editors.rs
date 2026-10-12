use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Logical description of a code editor (built-in default or user-added).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Editor {
    pub id: String,
    pub name: String,
    /// Absolute path to the editor's `extensions` directory.
    pub path: String,
    /// Whether this editor is one of the four built-in defaults (cannot be deleted, only path-edited).
    pub built_in: bool,
    /// Process executable names used to detect "running" state on Windows.
    pub process_names: Vec<String>,
}

impl Editor {
    pub fn path_buf(&self) -> PathBuf {
        PathBuf::from(&self.path)
    }
}

/// Default extension directories on Windows.
/// Source of truth — referenced when settings are missing or reset.
pub fn default_editors() -> Vec<Editor> {
    let home = dirs::home_dir().unwrap_or_default();
    // Use chained .join() so the resulting PathBuf uses native separators
    // (mixing "/" inside a single segment leaves it as-is on Windows, which
    // breaks explorer.exe).
    let make = |id: &str, name: &str, dir: &str, processes: &[&str]| Editor {
        id: id.to_string(),
        name: name.to_string(),
        path: home.join(dir).join("extensions").to_string_lossy().to_string(),
        built_in: true,
        process_names: processes.iter().map(|s| s.to_string()).collect(),
    };
    vec![
        make("vscode", "VSCode", ".vscode", &["Code.exe"]),
        make("cursor", "Cursor", ".cursor", &["Cursor.exe"]),
        make("windsurf", "Windsurf", ".windsurf", &["Windsurf.exe"]),
        make("trae", "Trae", ".trae", &["Trae.exe"]),
    ]
}
