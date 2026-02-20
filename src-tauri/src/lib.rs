mod clipboard_watcher;
mod commands;
mod models;
mod paste;
mod storage;

use log::info;
use std::sync::Arc;
use storage::Storage;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Manager, Emitter, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Logging in debug
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Initialize storage
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            let storage = Arc::new(Storage::new(&app_data_dir));

            // Get shortcut from settings before moving storage into state
            let shortcut_str = {
                let data = storage.data.lock().unwrap();
                data.settings.shortcut_toggle.clone()
            };

            // Manage state
            app.manage(storage.clone());

            // Start clipboard watcher
            clipboard_watcher::start_clipboard_watcher(
                app.handle().clone(),
                storage.clone(),
            );

            // Setup tray icon
            setup_tray(app)?;

            // Setup global shortcut
            setup_global_shortcut(app, &shortcut_str)?;

            // Auto-hide on blur (focus lost)
            let window = app.get_webview_window("main").unwrap();
            let handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let WindowEvent::Focused(false) = event {
                    // Delay to allow paste-and-hide to complete
                    let h = handle.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(150));
                        if let Some(w) = h.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                w.hide().ok();
                            }
                        }
                    });
                }
            });

            info!("CoPas initialized successfully!");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_tabs,
            commands::create_tab,
            commands::rename_tab,
            commands::delete_tab,
            commands::get_history,
            commands::delete_item,
            commands::delete_multiple,
            commands::pin_item,
            commands::move_to_tab,
            commands::label_item,
            commands::copy_to_clipboard,
            commands::bulk_copy,
            commands::paste_and_hide,
            commands::bulk_paste_and_hide,
            commands::hide_popup,
            commands::clear_history,
            commands::get_stats,
            commands::get_settings,
            commands::set_settings,
            commands::window_minimize,
            commands::window_close,
            commands::window_quit,
            commands::get_version,
            commands::check_for_update,
            commands::install_update,
            commands::get_image_url,
            commands::capture_screen,
            commands::copy_image_to_clipboard,
            commands::window_fullscreen,
            commands::set_vault_pin,
            commands::verify_vault_pin,
            commands::has_vault_pin,
            commands::move_to_vault,
            commands::remove_from_vault,
            commands::get_vault_items,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Show window on first launch so the user knows the app is running
    if let Some(_window) = app.get_webview_window("main") {
        // Brief delay to let the webview load
        let handle = app.handle().clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(500));
            show_popup(&handle);
        });
    }

    app.run(|app_handle, event| {
        // Handle macOS dock icon click → show popup
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            show_popup(app_handle);
        }
    });
}

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let open_item = MenuItemBuilder::with_id("open", "📋 Mở CoPas").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "❌ Thoát").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&open_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("CoPas")
        .on_menu_event(move |app_handle, event| {
            match event.id().as_ref() {
                "open" => {
                    show_popup(app_handle);
                }
                "quit" => {
                    app_handle.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { .. } = event {
                let app_handle = tray.app_handle();
                if let Some(window) = app_handle.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        window.hide().ok();
                    } else {
                        show_popup(app_handle);
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

fn setup_global_shortcut(
    app: &tauri::App,
    shortcut_str: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    // Parse shortcut string like "Cmd+Shift+V" or "Ctrl+Shift+V"
    let shortcut = parse_shortcut(shortcut_str)?;

    app.global_shortcut().on_shortcut(shortcut, move |app_handle, _hotkey, event| {
        if event.state == ShortcutState::Pressed {
            if let Some(window) = app_handle.get_webview_window("main") {
                if window.is_visible().unwrap_or(false) {
                    window.hide().ok();
                } else {
                    show_popup(app_handle);
                }
            }
        }
    })?;

    Ok(())
}

fn parse_shortcut(s: &str) -> Result<Shortcut, Box<dyn std::error::Error>> {
    let parts: Vec<&str> = s.split('+').collect();
    let mut mods = Modifiers::empty();
    let mut key_code: Option<Code> = None;

    for part in &parts {
        match part.to_lowercase().as_str() {
            "cmd" | "meta" | "command" | "super" => mods |= Modifiers::META,
            "ctrl" | "control" => mods |= Modifiers::CONTROL,
            "shift" => mods |= Modifiers::SHIFT,
            "alt" | "option" => mods |= Modifiers::ALT,
            key => {
                key_code = Some(match key {
                    "a" => Code::KeyA,
                    "b" => Code::KeyB,
                    "c" => Code::KeyC,
                    "d" => Code::KeyD,
                    "e" => Code::KeyE,
                    "f" => Code::KeyF,
                    "g" => Code::KeyG,
                    "h" => Code::KeyH,
                    "i" => Code::KeyI,
                    "j" => Code::KeyJ,
                    "k" => Code::KeyK,
                    "l" => Code::KeyL,
                    "m" => Code::KeyM,
                    "n" => Code::KeyN,
                    "o" => Code::KeyO,
                    "p" => Code::KeyP,
                    "q" => Code::KeyQ,
                    "r" => Code::KeyR,
                    "s" => Code::KeyS,
                    "t" => Code::KeyT,
                    "u" => Code::KeyU,
                    "v" => Code::KeyV,
                    "w" => Code::KeyW,
                    "x" => Code::KeyX,
                    "y" => Code::KeyY,
                    "z" => Code::KeyZ,
                    "0" => Code::Digit0,
                    "1" => Code::Digit1,
                    "2" => Code::Digit2,
                    "3" => Code::Digit3,
                    "4" => Code::Digit4,
                    "5" => Code::Digit5,
                    "6" => Code::Digit6,
                    "7" => Code::Digit7,
                    "8" => Code::Digit8,
                    "9" => Code::Digit9,
                    "f1" => Code::F1,
                    "f2" => Code::F2,
                    "f3" => Code::F3,
                    "f4" => Code::F4,
                    "f5" => Code::F5,
                    "f6" => Code::F6,
                    "f7" => Code::F7,
                    "f8" => Code::F8,
                    "f9" => Code::F9,
                    "f10" => Code::F10,
                    "f11" => Code::F11,
                    "f12" => Code::F12,
                    "space" => Code::Space,
                    "enter" | "return" => Code::Enter,
                    "escape" | "esc" => Code::Escape,
                    "tab" => Code::Tab,
                    "backspace" => Code::Backspace,
                    "delete" => Code::Delete,
                    "arrowup" | "up" => Code::ArrowUp,
                    "arrowdown" | "down" => Code::ArrowDown,
                    "arrowleft" | "left" => Code::ArrowLeft,
                    "arrowright" | "right" => Code::ArrowRight,
                    _ => return Err(format!("Unknown key: {}", key).into()),
                });
            }
        }
    }

    let code = key_code.ok_or("No key specified in shortcut")?;
    Ok(Shortcut::new(Some(mods), code))
}

fn show_popup(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        // Use center() which correctly handles DPI/scale factor on Retina displays
        window.center().ok();

        window.show().ok();
        window.set_focus().ok();

        // Emit popup-shown event for frontend to focus search
        app_handle.emit("popup-shown", ()).ok();
    }
}
