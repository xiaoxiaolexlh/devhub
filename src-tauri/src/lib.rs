mod ai_agents;
mod cleaner;
mod commands;
mod editors;
mod explorer_menu;
mod manifest;
mod node_services;
mod scanner;
mod settings;
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
    list_terminal_sessions, open_default_path, open_folder_window, open_in_explorer,
    open_path_window, open_with_method, preview_hbuilderx_publish_app_resource,
    preview_hbuilderx_publish_mp_alipay, preview_hbuilderx_run_web, purge_trash,
    read_workspace_dir, read_workspace_file, resolve_hbuilderx_cli,
    run_hbuilderx_publish_app_resource, run_hbuilderx_publish_mp_alipay, run_hbuilderx_web,
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
use tauri::Manager;
use tools::{
    custom_tool_open, custom_tool_open_dir, tool_check_updates, tool_download, tool_is_elevated,
    tool_launch, tool_list, tool_open_dir, tool_restart_elevated, tool_update,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            ai_agent_check_node,
            ai_agent_list,
            ai_agent_latest_versions,
            ai_agent_install,
            ai_agent_uninstall,
            ai_agent_task_list,
            ai_agent_task_stop,
            ai_agent_task_clear,
        ])
        .setup(|app| {
            // migrate legacy data dirs into the unified app data directory
            settings::migrate_old_data();

            // best-effort cleanup of expired trash on startup
            let s = settings::load();
            syncer::purge_old_trash(s.backup_days);

            let mut args = std::env::args_os().skip(1);
            let first = args.next();
            let second = args.next();
            let has_open_argument = first.is_some();
            let opened = match (first, second) {
                (Some(flag), Some(path)) if flag == "--open-with-default" => {
                    open_default_path(app.handle(), path.to_string_lossy().to_string())
                }
                (Some(path), _) => {
                    open_path_window(app.handle(), path.to_string_lossy().to_string())
                }
                _ => Ok(()),
            };
            if opened.is_ok() && has_open_argument {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.close();
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
