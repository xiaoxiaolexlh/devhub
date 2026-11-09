mod ai_agents;
mod cleaner;
mod commands;
mod editors;
mod environment;
mod explorer_menu;
mod manifest;
mod node_services;
mod scanner;
mod settings;
mod startup;
mod syncer;
mod system_settings;
mod terminal;
mod tools;

use ai_agents::{
    ai_agent_check_node, ai_agent_install, ai_agent_latest_versions, ai_agent_list,
    ai_agent_task_clear, ai_agent_task_list, ai_agent_task_stop, ai_agent_uninstall,
};

use cleaner::{
    cleaner_execute_profile, cleaner_export_config, cleaner_import_config, cleaner_load_config,
    cleaner_path_status, cleaner_preview_profile, cleaner_save_config,
};
use commands::{
    check_running_processes, close_terminal_project_sessions, close_terminal_session,
    close_terminal_tool_sessions, copy_extensions, delete_extensions, export_ai_config_tools,
    export_hbuilderx_cli_config, filter_terminal_project_directories, focus_terminal_session,
    get_ai_config_tool_files, get_ai_config_tool_statuses, get_hbuilderx_web_runs, get_settings,
    import_ai_config_tools, import_hbuilderx_cli_config, launch_terminal_session, list_editors,
    list_terminal_sessions, open_folder_window, open_in_explorer, open_path_window, open_with_method,
    preview_hbuilderx_publish_app_resource,
    preview_hbuilderx_publish_cloud_pack, preview_hbuilderx_publish_mp_alipay,
    preview_hbuilderx_run_web, purge_trash, read_workspace_dir, read_workspace_file,
    resolve_hbuilderx_cli, run_hbuilderx_publish_app_resource,
    run_hbuilderx_publish_cloud_pack, run_hbuilderx_publish_mp_alipay, run_hbuilderx_web,
    save_settings, scan_all, scan_extensions, scan_project_config_dirs,
    stop_all_hbuilderx_web_runs, stop_hbuilderx_web, sync_project_configs, write_workspace_file,
};
use node_services::{
    node_service_clear_task, node_service_list_tasks, node_service_read_info, node_service_run,
    node_service_start_http, node_service_stop_service, node_service_stop_task,
};
use system_settings::{
    system_list_known_folders, system_restore_known_folder, system_set_known_folder,
    system_turn_off_display,
};
use tools::{
    custom_tool_open, custom_tool_open_dir, tool_check_updates, tool_download, tool_is_elevated,
    tool_launch, tool_list, tool_open_dir, tool_restart_elevated, tool_update,
};

/// Background colour matching the frontend palette (`--bg` in src/index.css).
/// Used while the webview has not produced its first frame yet.
pub(crate) fn window_bg_color(window: &tauri::WebviewWindow, theme: &str) -> tauri::window::Color {
    let dark = match theme {
        "dark" => true,
        "light" => false,
        // "system": ask the window, which reports the OS theme. Fall back to
        // the dark background configured for the window.
        _ => !matches!(window.theme(), Ok(tauri::Theme::Light)),
    };
    if dark {
        tauri::window::Color(0x0f, 0x17, 0x2a, 0xff)
    } else {
        tauri::window::Color(0xff, 0xff, 0xff, 0xff)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Resolve Explorer requests before creating Tauri or a WebView. External
    // openers only need the saved settings and can exit immediately after launch.
    settings::migrate_old_data();
    let s = settings::load();
    let startup = startup::resolve(std::env::args_os().skip(1), &s);
    let workspace_path = match startup {
        Ok(startup::StartupAction::Main) => None,
        Ok(startup::StartupAction::Workspace(path)) => Some(path),
        Ok(startup::StartupAction::Explorer(path)) => match open_in_explorer(path) {
            Ok(()) => return,
            Err(error) => {
                eprintln!("Failed to open startup path: {error}");
                None
            }
        },
        Ok(startup::StartupAction::ExternalApp { method, path }) => {
            match commands::open_with_external_app(&method, path) {
                Ok(()) => return,
                Err(error) => {
                    eprintln!("Failed to open startup path: {error}");
                    None
                }
            }
        }
        Err(error) => {
            eprintln!("Failed to resolve startup path: {error}");
            None
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            list_editors,
            scan_extensions,
            scan_all,
            copy_extensions,
            scan_project_config_dirs,
            sync_project_configs,
            resolve_hbuilderx_cli,
            preview_hbuilderx_run_web,
            run_hbuilderx_web,
            get_hbuilderx_web_runs,
            stop_all_hbuilderx_web_runs,
            preview_hbuilderx_publish_app_resource,
            run_hbuilderx_publish_app_resource,
            preview_hbuilderx_publish_cloud_pack,
            run_hbuilderx_publish_cloud_pack,
            preview_hbuilderx_publish_mp_alipay,
            run_hbuilderx_publish_mp_alipay,
            stop_hbuilderx_web,
            export_hbuilderx_cli_config,
            import_hbuilderx_cli_config,
            get_ai_config_tool_statuses,
            get_ai_config_tool_files,
            node_service_read_info,
            node_service_run,
            node_service_start_http,
            node_service_list_tasks,
            node_service_stop_task,
            node_service_stop_service,
            node_service_clear_task,
            export_ai_config_tools,
            import_ai_config_tools,
            delete_extensions,
            open_in_explorer,
            open_folder_window,
            open_with_method,
            read_workspace_dir,
            read_workspace_file,
            write_workspace_file,
            get_settings,
            save_settings,
            check_running_processes,
            list_terminal_sessions,
            filter_terminal_project_directories,
            launch_terminal_session,
            focus_terminal_session,
            close_terminal_session,
            close_terminal_project_sessions,
            close_terminal_tool_sessions,
            purge_trash,
            cleaner_load_config,
            cleaner_save_config,
            cleaner_import_config,
            cleaner_export_config,
            cleaner_path_status,
            cleaner_preview_profile,
            cleaner_execute_profile,
            tool_list,
            tool_download,
            tool_check_updates,
            tool_update,
            tool_launch,
            tool_open_dir,
            tool_is_elevated,
            tool_restart_elevated,
            custom_tool_open,
            custom_tool_open_dir,
            explorer_menu::explorer_menu_status,
            explorer_menu::explorer_menu_set_enabled,
            system_turn_off_display,
            system_list_known_folders,
            system_set_known_folder,
            system_restore_known_folder,
            environment::environment_list,
            environment::environment_save,
            environment::environment_delete,
            ai_agent_check_node,
            ai_agent_list,
            ai_agent_latest_versions,
            ai_agent_install,
            ai_agent_uninstall,
            ai_agent_task_list,
            ai_agent_task_stop,
            ai_agent_task_clear,
        ])
        .setup(move |app| {
            // best-effort cleanup of expired trash on startup
            syncer::purge_old_trash(s.backup_days);

            if let Some(path) = workspace_path {
                match open_path_window(app.handle(), path) {
                    Ok(()) => return Ok(()),
                    Err(error) => eprintln!("Failed to open startup workspace: {error}"),
                }
            }

            // Main is opt-in (create: false): only normal launches or failed open
            // requests need it. Successful workspace requests never create it.
            let main_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .ok_or("main window configuration is missing")?;
            let main = tauri::WebviewWindowBuilder::from_config(app, main_config)?.build()?;
            // Paint the saved theme before showing the hidden window.
            let _ = main.set_background_color(Some(window_bg_color(&main, &s.theme)));
            let _ = main.show();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
