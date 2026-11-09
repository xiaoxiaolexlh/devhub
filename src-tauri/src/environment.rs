//! Persistent Windows environment variables. Never use the process environment as
//! the source of truth, and never expand %VAR% references while reading/writing.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnvironmentScope {
    User,
    System,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct EnvironmentVariable {
    pub name: String,
    pub value: String,
    pub value_type: u32,
}

#[derive(Serialize)]
pub struct EnvironmentSnapshot {
    pub variables: Vec<EnvironmentVariable>,
    pub writable: bool,
}

#[derive(Serialize)]
pub struct EnvironmentChangeResult {
    pub notification_sent: bool,
}

const STRING: u32 = 1;
const EXPAND_STRING: u32 = 2;

fn validate_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() || name.contains(['=', '\0']) {
        return Err("变量名不能为空，且不能包含等号或空字符".into());
    }
    if name.encode_utf16().count() > 16_383 {
        return Err("变量名过长，最多支持 16383 个 UTF-16 单元".into());
    }
    Ok(())
}

fn validate_variable(variable: &EnvironmentVariable) -> Result<(), String> {
    validate_name(&variable.name)?;
    if !matches!(variable.value_type, STRING | EXPAND_STRING) {
        return Err("仅支持字符串和可展开字符串类型的环境变量".into());
    }
    if variable.value.contains('\0') {
        return Err("变量值不能包含空字符".into());
    }
    if variable.value.encode_utf16().count() > 32_766 {
        return Err("变量值过长，最多支持 32766 个 UTF-16 单元".into());
    }
    Ok(())
}

trait EnvironmentStore {
    fn read(&self, name: &str) -> Result<Option<EnvironmentVariable>, String>;
    fn set(&self, variable: &EnvironmentVariable) -> Result<(), String>;
    fn delete(&self, name: &str) -> Result<(), String>;
}

fn check_expected(
    store: &impl EnvironmentStore,
    name: &str,
    expected: Option<&EnvironmentVariable>,
) -> Result<(), String> {
    if let Some(previous) = expected {
        if previous.name != name || !matches!(previous.value_type, STRING | EXPAND_STRING) {
            return Err("原变量信息无效，请刷新后重试".into());
        }
    }
    let current = store.read(name)?;
    if current.as_ref() != expected {
        return Err(if expected.is_none() && current.is_some() {
            "同名变量已存在（名称不区分大小写），请使用编辑功能".into()
        } else {
            "变量已被其他操作修改或删除，请关闭弹窗并刷新后重试".into()
        });
    }
    Ok(())
}

fn save_variable(
    store: &impl EnvironmentStore,
    variable: &EnvironmentVariable,
    expected: Option<&EnvironmentVariable>,
) -> Result<(), String> {
    validate_variable(variable)?;
    check_expected(store, &variable.name, expected)?;
    store.set(variable)
}

fn delete_variable(
    store: &impl EnvironmentStore,
    expected: &EnvironmentVariable,
) -> Result<(), String> {
    validate_name(&expected.name)?;
    check_expected(store, &expected.name, Some(expected))?;
    store.delete(&expected.name)
}

#[tauri::command]
pub async fn environment_list(scope: EnvironmentScope) -> Result<EnvironmentSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || platform::list(scope))
        .await
        .map_err(|error| format!("读取环境变量任务失败: {error}"))?
}

#[tauri::command]
pub async fn environment_save(
    scope: EnvironmentScope,
    variable: EnvironmentVariable,
    expected: Option<EnvironmentVariable>,
) -> Result<EnvironmentChangeResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Validate before opening a writable key (which can create HKCU\Environment).
        validate_variable(&variable)?;
        platform::change(scope, |store| {
            save_variable(store, &variable, expected.as_ref())
        })
    })
    .await
    .map_err(|error| format!("保存环境变量任务失败: {error}"))?
}

#[tauri::command]
pub async fn environment_delete(
    scope: EnvironmentScope,
    expected: EnvironmentVariable,
) -> Result<EnvironmentChangeResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_name(&expected.name)?;
        platform::change(scope, |store| delete_variable(store, &expected))
    })
    .await
    .map_err(|error| format!("删除环境变量任务失败: {error}"))?
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::ptr::{null, null_mut};
    use std::sync::Mutex;
    use windows_sys::Win32::Foundation::{
        ERROR_ACCESS_DENIED, ERROR_FILE_NOT_FOUND, ERROR_MORE_DATA, ERROR_NO_MORE_ITEMS,
        ERROR_SUCCESS,
    };
    use windows_sys::Win32::System::Registry::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };

    static MUTATION_LOCK: Mutex<()> = Mutex::new(());

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }

    fn location(scope: EnvironmentScope) -> (HKEY, &'static str) {
        match scope {
            EnvironmentScope::User => (HKEY_CURRENT_USER, "Environment"),
            EnvironmentScope::System => (
                HKEY_LOCAL_MACHINE,
                "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
            ),
        }
    }

    fn os_error(action: &str, code: u32) -> String {
        if code == ERROR_ACCESS_DENIED {
            return format!("{action}：权限不足。系统变量请以管理员身份重新打开 DevHub 后修改");
        }
        format!(
            "{action}: {}",
            std::io::Error::from_raw_os_error(code as i32)
        )
    }

    pub(super) struct RegistryStore(HKEY);

    impl Drop for RegistryStore {
        fn drop(&mut self) {
            unsafe { RegCloseKey(self.0) };
        }
    }

    fn open(scope: EnvironmentScope, write: bool) -> Result<Option<RegistryStore>, String> {
        let (root, path) = location(scope);
        let path = wide(path);
        let access = KEY_QUERY_VALUE | if write { KEY_SET_VALUE } else { 0 };
        let mut key = null_mut();
        let mut code = unsafe { RegOpenKeyExW(root, path.as_ptr(), 0, access, &mut key) };
        if code == ERROR_FILE_NOT_FOUND && write && matches!(scope, EnvironmentScope::User) {
            code = unsafe {
                RegCreateKeyExW(
                    root,
                    path.as_ptr(),
                    0,
                    null(),
                    REG_OPTION_NON_VOLATILE,
                    access,
                    null(),
                    &mut key,
                    null_mut(),
                )
            };
        }
        match code {
            ERROR_SUCCESS => Ok(Some(RegistryStore(key))),
            ERROR_FILE_NOT_FOUND => Ok(None),
            _ => Err(os_error("打开环境变量失败", code)),
        }
    }

    fn can_write(scope: EnvironmentScope) -> bool {
        let (root, path) = location(scope);
        let path = wide(path);
        let mut key = null_mut();
        // A permission probe only; never create a registry key while listing.
        let code = unsafe {
            RegOpenKeyExW(
                root,
                path.as_ptr(),
                0,
                KEY_QUERY_VALUE | KEY_SET_VALUE,
                &mut key,
            )
        };
        if code == ERROR_SUCCESS {
            drop(RegistryStore(key));
            true
        } else {
            code == ERROR_FILE_NOT_FOUND && matches!(scope, EnvironmentScope::User)
        }
    }

    pub(super) fn decode_string(bytes: &[u8]) -> Result<String, String> {
        if bytes.len() % 2 != 0 {
            return Err("字符串的 UTF-16 数据长度无效".into());
        }
        let mut units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        if units.last() == Some(&0) {
            units.pop();
        }
        if units.contains(&0) {
            return Err("字符串包含内部空字符".into());
        }
        String::from_utf16(&units).map_err(|_| "字符串包含无效的 UTF-16 数据".into())
    }

    impl EnvironmentStore for RegistryStore {
        fn read(&self, name: &str) -> Result<Option<EnvironmentVariable>, String> {
            let name_w = wide(name);
            // Another process can resize the value between the size/read calls.
            for _ in 0..5 {
                let mut size = 0;
                let mut value_type = 0;
                let code = unsafe {
                    RegQueryValueExW(
                        self.0,
                        name_w.as_ptr(),
                        null(),
                        &mut value_type,
                        null_mut(),
                        &mut size,
                    )
                };
                if code == ERROR_FILE_NOT_FOUND {
                    return Ok(None);
                }
                if code != ERROR_SUCCESS {
                    return Err(os_error("读取环境变量失败", code));
                }
                if !matches!(value_type, STRING | EXPAND_STRING) {
                    return Ok(Some(EnvironmentVariable {
                        name: name.into(),
                        value: String::new(),
                        value_type,
                    }));
                }
                let mut data = vec![0u8; (size as usize).max(2)];
                let code = unsafe {
                    RegQueryValueExW(
                        self.0,
                        name_w.as_ptr(),
                        null(),
                        &mut value_type,
                        data.as_mut_ptr(),
                        &mut size,
                    )
                };
                if code == ERROR_MORE_DATA {
                    continue;
                }
                if code == ERROR_FILE_NOT_FOUND {
                    return Ok(None);
                }
                if code != ERROR_SUCCESS {
                    return Err(os_error("读取环境变量失败", code));
                }
                let value = if matches!(value_type, STRING | EXPAND_STRING) {
                    decode_string(&data[..size as usize])
                        .map_err(|e| format!("无法读取变量「{name}」: {e}"))?
                } else {
                    String::new()
                };
                return Ok(Some(EnvironmentVariable {
                    name: name.into(),
                    value,
                    value_type,
                }));
            }
            Err("变量正被其他程序频繁修改，请稍后刷新".into())
        }

        fn set(&self, variable: &EnvironmentVariable) -> Result<(), String> {
            let name = wide(&variable.name);
            let data = wide(&variable.value);
            let code = unsafe {
                RegSetValueExW(
                    self.0,
                    name.as_ptr(),
                    0,
                    variable.value_type,
                    data.as_ptr().cast(),
                    (data.len() * 2) as u32,
                )
            };
            if code == ERROR_SUCCESS {
                Ok(())
            } else {
                Err(os_error("保存环境变量失败", code))
            }
        }

        fn delete(&self, name: &str) -> Result<(), String> {
            let name = wide(name);
            let code = unsafe { RegDeleteValueW(self.0, name.as_ptr()) };
            if code == ERROR_SUCCESS {
                Ok(())
            } else {
                Err(os_error("删除环境变量失败", code))
            }
        }
    }

    pub(super) fn list(scope: EnvironmentScope) -> Result<EnvironmentSnapshot, String> {
        let mut variables = Vec::new();
        if let Some(store) = open(scope, false)? {
            let mut index = 0;
            loop {
                // Windows registry value names are limited to 16383 UTF-16 units.
                let mut name = vec![0u16; 16_384];
                let mut length = name.len() as u32;
                let code = unsafe {
                    RegEnumValueW(
                        store.0,
                        index,
                        name.as_mut_ptr(),
                        &mut length,
                        null(),
                        null_mut(),
                        null_mut(),
                        null_mut(),
                    )
                };
                if code == ERROR_NO_MORE_ITEMS {
                    break;
                }
                if code != ERROR_SUCCESS {
                    return Err(os_error("枚举环境变量失败", code));
                }
                let name = String::from_utf16(&name[..length as usize])
                    .map_err(|_| "环境变量名称包含无效的 UTF-16 数据".to_string())?;
                // The unnamed default registry value is not an environment variable.
                if !name.is_empty() {
                    if let Some(variable) = store.read(&name)? {
                        variables.push(variable);
                    }
                }
                index += 1;
            }
        }
        variables.sort_by_cached_key(|variable| variable.name.to_lowercase());
        Ok(EnvironmentSnapshot {
            variables,
            writable: can_write(scope),
        })
    }

    pub(super) fn change(
        scope: EnvironmentScope,
        action: impl FnOnce(&RegistryStore) -> Result<(), String>,
    ) -> Result<EnvironmentChangeResult, String> {
        let guard = MUTATION_LOCK
            .lock()
            .map_err(|_| "环境变量操作锁不可用，请重启应用")?;
        let store = open(scope, true)?.ok_or("环境变量注册表项不存在")?;
        action(&store)?;
        drop(store);
        drop(guard);
        // This is a persisted change even if a recipient times out. Do not report
        // a write failure or repeat a successful mutation in that case.
        let section = wide("Environment");
        let sent = unsafe {
            SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                0,
                section.as_ptr() as isize,
                SMTO_ABORTIFHUNG,
                1000,
                null_mut(),
            )
        };
        Ok(EnvironmentChangeResult {
            notification_sent: sent != 0,
        })
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;
    pub(super) struct UnsupportedStore;
    impl EnvironmentStore for UnsupportedStore {
        fn read(&self, _: &str) -> Result<Option<EnvironmentVariable>, String> {
            Err("仅支持 Windows".into())
        }
        fn set(&self, _: &EnvironmentVariable) -> Result<(), String> {
            Err("仅支持 Windows".into())
        }
        fn delete(&self, _: &str) -> Result<(), String> {
            Err("仅支持 Windows".into())
        }
    }
    pub(super) fn list(_: EnvironmentScope) -> Result<EnvironmentSnapshot, String> {
        Err("环境变量管理仅支持 Windows".into())
    }
    pub(super) fn change(
        _: EnvironmentScope,
        _: impl FnOnce(&UnsupportedStore) -> Result<(), String>,
    ) -> Result<EnvironmentChangeResult, String> {
        Err("环境变量管理仅支持 Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::BTreeMap;

    // No tests write to the real registry or process environment.
    #[derive(Default)]
    struct MemoryStore(RefCell<BTreeMap<String, EnvironmentVariable>>);
    impl EnvironmentStore for MemoryStore {
        fn read(&self, name: &str) -> Result<Option<EnvironmentVariable>, String> {
            Ok(self
                .0
                .borrow()
                .get(&name.to_uppercase())
                .cloned()
                .map(|mut v| {
                    v.name = name.into();
                    v
                }))
        }
        fn set(&self, variable: &EnvironmentVariable) -> Result<(), String> {
            self.0
                .borrow_mut()
                .insert(variable.name.to_uppercase(), variable.clone());
            Ok(())
        }
        fn delete(&self, name: &str) -> Result<(), String> {
            self.0.borrow_mut().remove(&name.to_uppercase());
            Ok(())
        }
    }
    fn variable(name: &str, value: &str, value_type: u32) -> EnvironmentVariable {
        EnvironmentVariable {
            name: name.into(),
            value: value.into(),
            value_type,
        }
    }

    #[test]
    fn crud_preserves_raw_values_types_and_unrelated_entries() {
        let store = MemoryStore::default();
        let other = variable("OTHER", "keep", STRING);
        save_variable(&store, &other, None).unwrap();
        let initial = variable("Path", " %USERPROFILE%\\工具;;C:\\bin; ", EXPAND_STRING);
        save_variable(&store, &initial, None).unwrap();
        assert_eq!(store.read("Path").unwrap(), Some(initial.clone()));
        let updated = variable("Path", "%JAVA_HOME%\\bin;C:\\测试;", EXPAND_STRING);
        save_variable(&store, &updated, Some(&initial)).unwrap();
        assert_eq!(store.read("Path").unwrap(), Some(updated.clone()));
        delete_variable(&store, &updated).unwrap();
        assert_eq!(store.read("Path").unwrap(), None);
        assert_eq!(store.read("OTHER").unwrap(), Some(other));
    }

    #[test]
    fn duplicate_names_are_case_insensitive() {
        let store = MemoryStore::default();
        save_variable(&store, &variable("Path", "original", STRING), None).unwrap();
        assert!(save_variable(&store, &variable("PATH", "replace", STRING), None).is_err());
        assert_eq!(store.read("Path").unwrap().unwrap().value, "original");
    }

    #[test]
    fn stale_edits_and_deletes_do_not_overwrite_newer_data() {
        let store = MemoryStore::default();
        let initial = variable("TEST", "old", STRING);
        let current = variable("TEST", "new", EXPAND_STRING);
        store.set(&current).unwrap();
        assert!(save_variable(&store, &initial, Some(&initial)).is_err());
        assert!(delete_variable(&store, &initial).is_err());
        assert_eq!(store.read("TEST").unwrap(), Some(current));
        store.delete("TEST").unwrap();
        assert!(save_variable(&store, &initial, Some(&initial)).is_err());
        assert!(delete_variable(&store, &initial).is_err());
    }

    #[test]
    fn empty_values_are_saved_instead_of_deleted() {
        let store = MemoryStore::default();
        let empty = variable("EMPTY", "", STRING);
        save_variable(&store, &empty, None).unwrap();
        assert_eq!(store.read("EMPTY").unwrap(), Some(empty));
    }

    #[test]
    fn invalid_inputs_do_not_write() {
        let store = MemoryStore::default();
        for v in [
            variable(" ", "", STRING),
            variable("A=B", "", STRING),
            variable("A\0B", "", STRING),
            variable("A", "x\0y", STRING),
            variable("A", "binary", 3),
            variable("A", &"😀".repeat(16_384), STRING),
        ] {
            assert!(save_variable(&store, &v, None).is_err());
        }
        assert!(store.0.borrow().is_empty());
        assert!(validate_variable(&variable("A", &"a".repeat(32_766), STRING)).is_ok());
    }

    #[test]
    fn unsupported_types_cannot_be_overwritten_or_deleted() {
        let store = MemoryStore::default();
        let original = variable("BINARY", "", 3);
        store.set(&original).unwrap();
        assert!(save_variable(&store, &variable("BINARY", "", STRING), Some(&original)).is_err());
        assert!(delete_variable(&store, &original).is_err());
        assert_eq!(store.read("BINARY").unwrap(), Some(original));
    }

    #[cfg(windows)]
    #[test]
    fn registry_string_decoding_is_lossless_and_rejects_corruption() {
        let raw = " %JAVA_HOME%\\工具;😀; ";
        let bytes: Vec<u8> = raw
            .encode_utf16()
            .chain(Some(0))
            .flat_map(u16::to_le_bytes)
            .collect();
        assert_eq!(platform::decode_string(&bytes).unwrap(), raw);
        assert_eq!(
            platform::decode_string(&bytes[..bytes.len() - 2]).unwrap(),
            raw
        );
        assert_eq!(platform::decode_string(&[0, 0]).unwrap(), "");
        assert!(platform::decode_string(&[0]).is_err());
        assert!(platform::decode_string(&[0, 0, 65, 0]).is_err());
        assert!(platform::decode_string(&[0, 0xd8]).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn native_registry_listing_is_read_only() {
        for scope in [EnvironmentScope::User, EnvironmentScope::System] {
            let snapshot = platform::list(scope).unwrap();
            assert!(snapshot
                .variables
                .iter()
                .all(|entry| !entry.name.is_empty()));
        }
    }
}
