use crate::commands::resolve_primary_open_method;
use crate::settings::{OpenMethod, OpenMethodKind, Settings};
use std::ffi::OsString;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum StartupAction {
    Main,
    Workspace(String),
    Explorer(String),
    ExternalApp { method: OpenMethod, path: String },
}

/// Resolve the request without creating a window or starting a process.
pub(crate) fn resolve(
    mut args: impl Iterator<Item = OsString>,
    settings: &Settings,
) -> Result<StartupAction, String> {
    let Some(first) = args.next() else {
        return Ok(StartupAction::Main);
    };
    if first != "--open-with-default" {
        return Ok(StartupAction::Workspace(
            first.to_string_lossy().into_owned(),
        ));
    }

    let path = args
        .next()
        .ok_or_else(|| "缺少要打开的文件或文件夹路径。".to_string())?
        .to_string_lossy()
        .into_owned();
    let method = resolve_primary_open_method(settings)
        .ok_or_else(|| "没有可用的打开方式，请检查设置中的启用状态和程序路径。".to_string())?;
    Ok(match method.kind {
        OpenMethodKind::Workspace => StartupAction::Workspace(path),
        OpenMethodKind::Explorer => StartupAction::Explorer(path),
        OpenMethodKind::ExternalApp => StartupAction::ExternalApp {
            method: method.clone(),
            path,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PATH: &str = r"D:\项目 文件\说明.md";

    fn request(args: &[&str], settings: &Settings) -> Result<StartupAction, String> {
        resolve(args.iter().map(OsString::from), settings)
    }

    #[test]
    fn ordinary_launch_opens_main() {
        assert_eq!(
            request(&[], &Settings::default()).unwrap(),
            StartupAction::Main
        );
    }

    #[test]
    fn plain_path_uses_workspace_regardless_of_default_method() {
        assert_eq!(
            request(&[PATH], &Settings::default()).unwrap(),
            StartupAction::Workspace(PATH.into())
        );
    }

    #[test]
    fn explorer_default_needs_no_devhub_window() {
        assert_eq!(
            request(&["--open-with-default", PATH], &Settings::default()).unwrap(),
            StartupAction::Explorer(PATH.into())
        );
    }

    #[test]
    fn external_default_preserves_program_arguments_and_unicode_path() {
        let mut settings = Settings::default();
        settings.default_open_method_id = "cursor".into();
        let method = settings
            .open_methods
            .iter_mut()
            .find(|m| m.id == "cursor")
            .unwrap();
        method.command = r"D:\Editor App\Cursor.exe".into();
        method.args_template = "--new-window \"{path}\"".into();
        let expected = method.clone();
        assert_eq!(
            request(&["--open-with-default", PATH], &settings).unwrap(),
            StartupAction::ExternalApp {
                method: expected,
                path: PATH.into()
            }
        );
    }

    #[test]
    fn workspace_default_only_needs_workspace_window() {
        let mut settings = Settings::default();
        settings.default_open_method_id = "workspace".into();
        assert_eq!(
            request(&["--open-with-default", PATH], &settings).unwrap(),
            StartupAction::Workspace(PATH.into())
        );
    }

    #[test]
    fn unavailable_default_falls_back_to_ready_workspace() {
        let mut settings = Settings::default();
        settings.default_open_method_id = "cursor".into();
        for method in &mut settings.open_methods {
            if method.id == "explorer" {
                method.enabled = false;
            }
            if method.id == "cursor" {
                method.command.clear();
            }
        }
        assert_eq!(
            request(&["--open-with-default", PATH], &settings).unwrap(),
            StartupAction::Workspace(PATH.into())
        );
    }

    #[test]
    fn invalid_request_returns_error_for_main_window_fallback() {
        let mut settings = Settings::default();
        assert!(request(&["--open-with-default"], &settings).is_err());
        for method in &mut settings.open_methods {
            method.enabled = false;
        }
        assert!(request(&["--open-with-default", PATH], &settings).is_err());
    }
}
