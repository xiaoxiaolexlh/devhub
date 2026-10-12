//! Manipulation of the per-editor `extensions.json` file (VSCode-style
//! "installed extensions" registry). Modern VSCode forks (Cursor, Windsurf,
//! Codebuddy, Trae, …) ignore extension folders that aren't listed here, so
//! every copy/delete must keep this file in sync with the on-disk layout.

use serde_json::{json, Value};
use std::fs;
use std::path::Path;

const MANIFEST_FILE: &str = "extensions.json";

/// Read the editor's extensions.json. Returns an empty Vec if file is missing
/// or unparseable (we will re-create it cleanly on the next write).
pub fn read_manifest(extensions_dir: &Path) -> Vec<Value> {
    let path = extensions_dir.join(MANIFEST_FILE);
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
}

/// Atomic write: emit to `.tmp`, then rename.
pub fn write_manifest(extensions_dir: &Path, entries: &[Value]) -> Result<(), String> {
    let path = extensions_dir.join(MANIFEST_FILE);
    let tmp = extensions_dir.join(format!("{}.tmp", MANIFEST_FILE));
    let json = serde_json::to_string(&entries).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| format!("write tmp: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("rename: {e}"))?;
    Ok(())
}

/// Produce the URI path VSCode expects for a Windows file URI. Drive letter is
/// lowercased per VSCode's normalization.
fn windows_uri_path(abs_path: &Path) -> String {
    let s = abs_path.to_string_lossy().replace('/', "\\");
    let lower_drive = {
        let mut chars: Vec<char> = s.chars().collect();
        if !chars.is_empty() && chars[0].is_ascii_alphabetic() {
            chars[0] = chars[0].to_ascii_lowercase();
        }
        chars.into_iter().collect::<String>()
    };
    let forward = lower_drive.replace('\\', "/"); // "c:/Users/..."
    format!("/{}", forward) // "/c:/Users/..."
}

/// After copying an extension folder into the target editor, register it in
/// the target's extensions.json so the editor will actually load it.
///
/// Keep the entry intentionally minimal. The extension's package.json remains
/// the source of truth for rich metadata; this file only needs enough data to
/// point the editor at the copied folder.
pub fn register_copied(
    target_extensions_dir: &Path,
    folder_name: &str,
    ext_id: &str,
    version: &str,
) -> Result<(), String> {
    let new_full = target_extensions_dir.join(folder_name);
    let url_path = windows_uri_path(&new_full);
    let ext_id = ext_id.to_lowercase();
    let new_entry: Value = json!({
        "identifier": { "id": ext_id.clone() },
        "version": version,
        "location": {
            "path": url_path,
            "scheme": "file"
        },
        "relativeLocation": folder_name
    });

    let mut target_entries = read_manifest(target_extensions_dir);
    target_entries.retain(|e| {
        e.get("identifier")
            .and_then(|i| i.get("id"))
            .and_then(|v| v.as_str())
            .map(|id| !id.eq_ignore_ascii_case(&ext_id))
            .unwrap_or(true)
    });
    target_entries.push(new_entry);

    write_manifest(target_extensions_dir, &target_entries)
}

/// Remove an entry pointing at `folder_name` from the target's extensions.json.
/// Silent no-op if the entry isn't there.
pub fn unregister(target_extensions_dir: &Path, folder_name: &str) -> Result<(), String> {
    let mut entries = read_manifest(target_extensions_dir);
    let before = entries.len();
    entries.retain(|e| {
        e.get("relativeLocation").and_then(|v| v.as_str()) != Some(folder_name)
    });
    if entries.len() == before {
        return Ok(());
    }
    write_manifest(target_extensions_dir, &entries)
}

/// Parse `<folder>/package.json` for the canonical extension id + version.
pub fn read_pkg_id_version(folder: &Path) -> Option<(String, String)> {
    let pkg = folder.join("package.json");
    let s = fs::read_to_string(&pkg).ok()?;
    let v: Value = serde_json::from_str(&s).ok()?;
    let publisher = v.get("publisher")?.as_str()?;
    let name = v.get("name")?.as_str()?;
    let version = v.get("version")?.as_str()?;
    Some((format!("{}.{}", publisher, name), version.to_string()))
}
