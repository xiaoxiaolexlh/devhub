//! RegisterHotKey must be registered, changed and removed on the same thread.
//! This worker owns the Windows message queue and swaps registrations only after
//! the new shortcut succeeds, so a conflict never removes the working shortcut.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shortcut {
    pub modifiers: u32,
    pub key: u32,
}

impl Shortcut {
    pub const ESCAPE: Self = Self {
        modifiers: 0,
        key: 0x1B,
    };

    pub fn parse(value: &str) -> Result<Self, String> {
        let parts: Vec<_> = value.split('+').map(str::trim).collect();
        let (key, modifiers) = parts.split_last().ok_or("请输入快捷键")?;
        let mut mask = 0;
        for modifier in modifiers {
            let bit = match modifier.to_ascii_lowercase().as_str() {
                "alt" => 1,
                "ctrl" | "control" => 2,
                "shift" => 4,
                "win" | "super" | "meta" => 8,
                _ => return Err(format!("不支持的修饰键: {modifier}")),
            };
            if mask & bit != 0 {
                return Err("快捷键中不能重复修饰键".into());
            }
            mask |= bit;
        }
        if mask & (1 | 2 | 8) == 0 {
            return Err("快捷键至少包含 Ctrl、Alt 或 Win 中的一个".into());
        }
        let key = key.to_ascii_uppercase();
        let code = match key.as_str() {
            "SPACE" => 0x20,
            k if k.len() == 1 && k.as_bytes()[0].is_ascii_alphanumeric() => k.as_bytes()[0] as u32,
            k if k.starts_with('F') => k[1..]
                .parse::<u32>()
                .ok()
                .filter(|n| (1..=24).contains(n))
                .map(|n| 0x70 + n - 1)
                .ok_or("功能键范围为 F1 到 F24")?,
            _ => return Err("支持 Space、字母、数字和 F1 到 F24".into()),
        };
        Ok(Self {
            modifiers: mask,
            key: code,
        })
    }
}

#[cfg(windows)]
mod platform {
    use super::Shortcut;
    use std::{
        ptr::null_mut,
        sync::{mpsc, Mutex},
        thread,
    };
    use windows_sys::Win32::{
        System::Threading::GetCurrentThreadId,
        UI::{
            Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey, MOD_NOREPEAT},
            WindowsAndMessaging::{
                GetMessageW, PeekMessageW, PostThreadMessageW, MSG, PM_NOREMOVE, WM_APP, WM_HOTKEY,
                WM_QUIT,
            },
        },
    };
    const CHANGE: u32 = WM_APP + 71;
    enum Request {
        Prepare(Option<Shortcut>, mpsc::Sender<Result<(), String>>),
        Finish(bool, mpsc::Sender<Result<(), String>>),
    }

    pub struct HotkeyService {
        sender: mpsc::Sender<Request>,
        thread_id: u32,
        gate: Mutex<()>,
        worker: Option<thread::JoinHandle<()>>,
    }

    impl HotkeyService {
        pub fn new(callback: impl Fn() + Send + 'static) -> Result<Self, String> {
            let (sender, receiver) = mpsc::channel::<Request>();
            let (ready_tx, ready_rx) = mpsc::channel();
            let worker = thread::Builder::new()
                .name("devhub-hotkey".into())
                .spawn(move || unsafe {
                    let mut message: MSG = std::mem::zeroed();
                    PeekMessageW(&mut message, null_mut(), 0, 0, PM_NOREMOVE);
                    if ready_tx.send(GetCurrentThreadId()).is_err() {
                        return;
                    }
                    let mut current: Option<(i32, Shortcut)> = None;
                    let mut staged: Option<Option<(i32, Shortcut)>> = None;
                    while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
                        if message.message == CHANGE {
                            for request in receiver.try_iter() {
                                let (next, reply) = match request {
                                    Request::Prepare(next, reply) => (next, reply),
                                    Request::Finish(commit, reply) => {
                                        if let Some(next) = staged.take() {
                                            if commit {
                                                if let Some((id, _)) = current {
                                                    UnregisterHotKey(null_mut(), id);
                                                }
                                                current = next;
                                            } else if let Some((id, _)) = next {
                                                UnregisterHotKey(null_mut(), id);
                                            }
                                        }
                                        let _ = reply.send(Ok(()));
                                        continue;
                                    }
                                };
                                let result = if current.map(|(_, key)| key) == next {
                                    Ok(())
                                } else if let Some(next) = next {
                                    let id = if current.map(|(id, _)| id) == Some(1) {
                                        2
                                    } else {
                                        1
                                    };
                                    if RegisterHotKey(
                                        null_mut(),
                                        id,
                                        next.modifiers | MOD_NOREPEAT,
                                        next.key,
                                    ) == 0
                                    {
                                        Err(format!(
                                            "快捷键被占用或无法注册，请更换组合（{}）",
                                            std::io::Error::last_os_error()
                                        ))
                                    } else {
                                        staged = Some(Some((id, next)));
                                        Ok(())
                                    }
                                } else {
                                    staged = Some(None);
                                    Ok(())
                                };
                                let _ = reply.send(result);
                            }
                        } else if message.message == WM_HOTKEY
                            && current.map(|(id, _)| id as usize) == Some(message.wParam)
                        {
                            callback();
                        }
                    }
                    if let Some((id, _)) = current {
                        UnregisterHotKey(null_mut(), id);
                    }
                    if let Some(Some((id, _))) = staged {
                        UnregisterHotKey(null_mut(), id);
                    }
                })
                .map_err(|e| e.to_string())?;
            let thread_id = ready_rx.recv().map_err(|e| e.to_string())?;
            Ok(Self {
                sender,
                thread_id,
                gate: Mutex::new(()),
                worker: Some(worker),
            })
        }

        pub fn configure(&self, key: Option<Shortcut>) -> Result<(), String> {
            self.configure_with(key, || Ok(()))
        }

        /// Hold the old registration until settings persistence succeeds.
        pub fn configure_with(
            &self,
            key: Option<Shortcut>,
            persist: impl FnOnce() -> Result<(), String>,
        ) -> Result<(), String> {
            let _guard = self.gate.lock().map_err(|e| e.to_string())?;
            self.request(|reply| Request::Prepare(key, reply))?;
            let result = persist();
            self.request(|reply| Request::Finish(result.is_ok(), reply))?;
            result
        }

        fn request(
            &self,
            request: impl FnOnce(mpsc::Sender<Result<(), String>>) -> Request,
        ) -> Result<(), String> {
            let (reply, response) = mpsc::channel();
            self.sender
                .send(request(reply))
                .map_err(|e| e.to_string())?;
            if unsafe { PostThreadMessageW(self.thread_id, CHANGE, 0, 0) } == 0 {
                return Err("快捷键线程已停止".into());
            }
            response.recv().map_err(|e| e.to_string())?
        }
    }

    impl Drop for HotkeyService {
        fn drop(&mut self) {
            unsafe {
                PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0);
            }
            if let Some(worker) = self.worker.take() {
                let _ = worker.join();
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn background_shortcut_tracks_visibility_focus_and_releases_on_drop() {
            // Exercise real registration without reserving the user's Escape key.
            let key = Shortcut::parse("Ctrl+Alt+Shift+F19").unwrap();
            let (tx, rx) = mpsc::channel();
            let background = crate::hotkey::BackgroundHotkey::new(key, move || {
                let _ = tx.send(());
            })
            .unwrap();
            let other = HotkeyService::new(|| {}).unwrap();
            for (visible, focused, reserved) in [
                (false, false, false),
                (true, true, false),
                (true, false, true),
                (true, false, true),
                (true, true, false),
                (true, false, true),
                (false, false, false),
                (false, true, false),
                (true, false, true),
            ] {
                background.sync_window(visible, focused).unwrap();
                assert_eq!(other.configure(Some(key)).is_err(), reserved);
                other.configure(None).unwrap();
                unsafe {
                    PostThreadMessageW(background.service.thread_id, WM_HOTKEY, 1, 0);
                }
                let timeout = if reserved { 2000 } else { 50 };
                assert_eq!(
                    rx.recv_timeout(std::time::Duration::from_millis(timeout))
                        .is_ok(),
                    reserved
                );
            }
            drop(background);
            other.configure(Some(key)).unwrap();
        }

        #[test]
        fn background_shortcut_can_retry_after_a_conflict() {
            let key = Shortcut::parse("Ctrl+Alt+Shift+F18").unwrap();
            let background = crate::hotkey::BackgroundHotkey::new(key, || {}).unwrap();
            let other = HotkeyService::new(|| {}).unwrap();
            other.configure(Some(key)).unwrap();
            assert!(background.sync_window(true, false).is_err());
            background.sync_window(true, true).unwrap();
            other.configure(None).unwrap();
            background.sync_window(true, false).unwrap();
            assert!(other.configure(Some(key)).is_err());
            background.sync_window(false, false).unwrap();
            other.configure(Some(key)).unwrap();
        }

        #[test]
        fn conflict_preserves_old_registration_and_drop_releases_it() {
            let old = Shortcut::parse("Ctrl+Alt+Shift+F23").unwrap();
            let new = Shortcut::parse("Ctrl+Alt+Shift+F24").unwrap();
            let first = HotkeyService::new(|| {}).unwrap();
            let second = HotkeyService::new(|| {}).unwrap();
            first.configure(Some(old)).unwrap();
            second.configure(Some(new)).unwrap();
            assert!(first.configure(Some(new)).is_err());
            assert!(second.configure(Some(old)).is_err());
            second.configure(None).unwrap();
            first.configure(Some(new)).unwrap();
            second.configure(Some(old)).unwrap();
            drop(first);
            second.configure(Some(new)).unwrap();
        }
        #[test]
        fn dispatch_ignores_stale_registration_ids() {
            let (tx, rx) = mpsc::channel();
            let service = HotkeyService::new(move || {
                let _ = tx.send(());
            })
            .unwrap();
            service
                .configure(Some(Shortcut::parse("Ctrl+Alt+Shift+F22").unwrap()))
                .unwrap();
            unsafe {
                PostThreadMessageW(service.thread_id, WM_HOTKEY, 2, 0);
            }
            assert!(rx
                .recv_timeout(std::time::Duration::from_millis(50))
                .is_err());
            unsafe {
                PostThreadMessageW(service.thread_id, WM_HOTKEY, 1, 0);
            }
            rx.recv_timeout(std::time::Duration::from_secs(2)).unwrap();
        }
        #[test]
        fn failed_persistence_keeps_old_shortcut_reserved_and_releases_new_one() {
            let old = Shortcut::parse("Ctrl+Alt+Shift+F20").unwrap();
            let new = Shortcut::parse("Ctrl+Alt+Shift+F21").unwrap();
            let first = HotkeyService::new(|| {}).unwrap();
            let second = HotkeyService::new(|| {}).unwrap();
            first.configure(Some(old)).unwrap();
            let result = first.configure_with(Some(new), || {
                assert!(second.configure(Some(old)).is_err());
                assert!(second.configure(Some(new)).is_err());
                Err("settings write failed".into())
            });
            assert_eq!(result.unwrap_err(), "settings write failed");
            assert!(second.configure(Some(old)).is_err());
            second.configure(Some(new)).unwrap();
        }
    }
}

#[cfg(windows)]
pub use platform::HotkeyService;

/// Reserve a shortcut only while its window is visible in the background.
/// Focused windows keep their normal WebView keyboard and IME handling.
pub struct BackgroundHotkey {
    service: HotkeyService,
    shortcut: Shortcut,
}

impl BackgroundHotkey {
    pub fn new(shortcut: Shortcut, callback: impl Fn() + Send + 'static) -> Result<Self, String> {
        Ok(Self {
            service: HotkeyService::new(callback)?,
            shortcut,
        })
    }

    pub fn sync_window(&self, visible: bool, focused: bool) -> Result<(), String> {
        self.service
            .configure((visible && !focused).then_some(self.shortcut))
    }
}

#[cfg(not(windows))]
pub struct HotkeyService;
#[cfg(not(windows))]
impl HotkeyService {
    pub fn new(_: impl Fn() + Send + 'static) -> Result<Self, String> {
        Ok(Self)
    }
    pub fn configure(&self, key: Option<Shortcut>) -> Result<(), String> {
        if key.is_some() {
            Err("全局快捷键目前仅支持 Windows".into())
        } else {
            Ok(())
        }
    }
    pub fn configure_with(
        &self,
        key: Option<Shortcut>,
        persist: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        self.configure(key)?;
        persist()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_case_whitespace_and_function_keys() {
        assert_eq!(
            Shortcut::parse(" ctrl + ALT + Space ").unwrap(),
            Shortcut {
                modifiers: 3,
                key: 32
            }
        );
        assert_eq!(
            Shortcut::parse("Win+Shift+F24").unwrap(),
            Shortcut {
                modifiers: 12,
                key: 135
            }
        );
        assert_eq!(Shortcut::parse("Ctrl+k").unwrap().key, 75);
    }
    #[test]
    fn refuses_typing_keys_duplicates_and_invalid_combinations() {
        for value in [
            "",
            "Space",
            "Shift+A",
            "Ctrl+Ctrl+K",
            "Ctrl+Control+K",
            "Ctrl+",
            "Ctrl+F25",
            "Ctrl+F0",
            "Ctrl+A+B",
        ] {
            assert!(Shortcut::parse(value).is_err(), "{value}");
        }
    }
}
