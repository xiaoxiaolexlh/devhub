use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

use crate::manifest;

/// A scanned VSCode-compatible extension folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Extension {
    /// Lower-cased canonical id, `publisher.name`.
    pub id: String,
    pub publisher: String,
    pub name: String,
    pub display_name: Option<String>,
    pub version: String,
    pub description: Option<String>,
    /// Absolute path to icon image inside the extension folder, if any.
    pub icon_path: Option<String>,
    /// On-disk folder name, usually `publisher.name-version`.
    pub folder_name: String,
    /// Absolute path of the extension folder.
    pub folder_path: String,
    pub size_bytes: u64,
    /// `engines.vscode` field as declared in package.json.
    pub engines_vscode: Option<String>,
    /// True if publisher matches a known Microsoft proprietary prefix
    /// (e.g. C/C++, Pylance) where licensing restricts non-VSCode use.
    pub is_ms_proprietary: bool,
    /// True if the folder is listed in this editor's `extensions.json`
    /// (the only thing the editor actually loads). False = orphan folder on disk.
    pub registered: bool,
}

const MS_PROPRIETARY_PREFIXES: &[&str] = &[
    "ms-vscode.",
    "ms-vscode-",
    "ms-python.",
    "ms-toolsai.",
    "ms-azuretools.",
    "ms-dotnettools.",
    "ms-vsliveshare.",
    "visualstudioexptteam.",
];

/// Scan the top-level entries of an extensions directory and collect valid extensions.
/// Silently skips folders without a readable `package.json`.
pub fn scan_extensions(dir: &Path) -> Vec<Extension> {
    let mut out = Vec::new();
    let Ok(read) = fs::read_dir(dir) else {
        return out;
    };

    for entry in read.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_dir() {
            continue;
        }
        let folder_path = entry.path();
        let pkg_path = folder_path.join("package.json");
        if !pkg_path.exists() {
            continue;
        }
        let Ok(content) = fs::read_to_string(&pkg_path) else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) else {
            continue;
        };

        let publisher = str_field(&json, "publisher").unwrap_or_default();
        let name = str_field(&json, "name").unwrap_or_default();
        if publisher.is_empty() || name.is_empty() {
            continue;
        }

        let version = str_field(&json, "version").unwrap_or_default();
        let display_name = str_field(&json, "displayName");
        let description = str_field(&json, "description");
        let icon_rel = str_field(&json, "icon");
        let icon_path = icon_rel
            .as_ref()
            .map(|i| folder_path.join(i))
            .filter(|p| p.exists())
            .map(|p| p.to_string_lossy().to_string());
        let engines_vscode = json
            .get("engines")
            .and_then(|v| v.get("vscode"))
            .and_then(|v| v.as_str())
            .map(String::from);

        let id = format!("{}.{}", publisher, name).to_lowercase();
        let is_ms_proprietary = MS_PROPRIETARY_PREFIXES.iter().any(|p| id.starts_with(p));
        let folder_name = folder_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let size_bytes = compute_size(&folder_path);

        out.push(Extension {
            id,
            publisher,
            name,
            display_name,
            version,
            description,
            icon_path,
            folder_name,
            folder_path: folder_path.to_string_lossy().to_string(),
            size_bytes,
            engines_vscode,
            is_ms_proprietary,
            registered: false, // filled in below
        });
    }

    // Cross-reference with extensions.json. If the manifest is missing or empty,
    // assume the editor hasn't been launched yet and treat every folder as
    // registered (otherwise a fresh editor would show all folders as orphans).
    let manifest_entries = manifest::read_manifest(dir);
    if manifest_entries.is_empty() {
        for ext in out.iter_mut() {
            ext.registered = true;
        }
    } else {
        let registered: HashSet<String> = manifest_entries
            .iter()
            .filter_map(|e| {
                e.get("relativeLocation")
                    .and_then(|v| v.as_str())
                    .map(String::from)
            })
            .collect();
        for ext in out.iter_mut() {
            ext.registered = registered.contains(&ext.folder_name);
        }
    }

    out
}

fn str_field(json: &serde_json::Value, key: &str) -> Option<String> {
    json.get(key).and_then(|v| v.as_str()).map(String::from)
}

fn compute_size(dir: &Path) -> u64 {
    WalkDir::new(dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}
