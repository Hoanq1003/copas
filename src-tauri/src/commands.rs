use crate::models::{HistoryResult, Item, Stats};
use crate::paste;
use crate::storage::Storage;
use arboard::Clipboard;
use log::error;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State, Emitter};

// Type alias for managed state
pub type StorageState = Arc<Storage>;

// ============ TABS ============

#[tauri::command]
pub fn get_tabs(storage: State<StorageState>) -> Vec<crate::models::Tab> {
    let data = storage.data.lock().unwrap();
    data.tabs.clone()
}

#[tauri::command]
pub fn create_tab(
    storage: State<StorageState>,
    name: String,
    icon: Option<String>,
) -> crate::models::Tab {
    let tab = crate::models::Tab {
        id: format!("tab_{}", chrono::Utc::now().timestamp_millis()),
        name,
        icon: icon.unwrap_or_else(|| "📁".into()),
        system: false,
    };
    {
        let mut data = storage.data.lock().unwrap();
        data.tabs.push(tab.clone());
    }
    storage.save_sync();
    tab
}

#[tauri::command]
pub fn rename_tab(
    storage: State<StorageState>,
    id: String,
    name: Option<String>,
    icon: Option<String>,
) -> serde_json::Value {
    let mut data = storage.data.lock().unwrap();
    if let Some(tab) = data.tabs.iter_mut().find(|t| t.id == id) {
        if tab.system {
            return serde_json::json!({"success": false});
        }
        if let Some(n) = name {
            tab.name = n;
        }
        if let Some(i) = icon {
            tab.icon = i;
        }
        drop(data);
        storage.save_sync();
        serde_json::json!({"success": true})
    } else {
        serde_json::json!({"success": false})
    }
}

#[tauri::command]
pub fn delete_tab(storage: State<StorageState>, id: String) -> serde_json::Value {
    let mut data = storage.data.lock().unwrap();
    let is_system = data.tabs.iter().find(|t| t.id == id).map(|t| t.system).unwrap_or(true);
    if is_system {
        return serde_json::json!({"success": false});
    }
    data.tabs.retain(|t| t.id != id);
    // Reset items that were in this tab
    for item in &mut data.items {
        if item.tab_id.as_deref() == Some(&id) {
            item.tab_id = None;
        }
    }
    drop(data);
    storage.save_sync();
    serde_json::json!({"success": true})
}

// ============ ITEMS ============

#[tauri::command]
pub fn get_history(
    storage: State<StorageState>,
    search: Option<String>,
    tab_id: Option<String>,
    _page: Option<usize>,
    page_size: Option<usize>,
) -> HistoryResult {
    let data = storage.data.lock().unwrap();
    let mut items: Vec<Item> = data.items.clone();

    // Filter by tab
    if let Some(ref tid) = tab_id {
        if tid != "all" {
            if tid == "links" {
                items.retain(|i| i.category == "link" || i.tab_id.as_deref() == Some("links"));
            } else {
                items.retain(|i| i.tab_id.as_deref() == Some(tid.as_str()));
            }
        }
    }

    // Filter by search
    if let Some(ref q) = search {
        if !q.is_empty() {
            let ql = q.to_lowercase();
            items.retain(|i| {
                i.get_text().to_lowercase().contains(&ql)
                    || i.label.to_lowercase().contains(&ql)
                    || i.category.to_lowercase().contains(&ql)
            });
        }
    }

    // Sort: pinned first, then by timestamp (newest first)
    items.sort_by(|a, b| {
        match (a.pinned, b.pinned) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => b.timestamp.cmp(&a.timestamp),
        }
    });

    let total = items.len();
    let page_size = page_size.unwrap_or(500);
    items.truncate(page_size);

    HistoryResult { items, total }
}

#[tauri::command]
pub fn delete_item(storage: State<StorageState>, id: String) -> serde_json::Value {
    let mut data = storage.data.lock().unwrap();
    data.items.retain(|i| i.id != id);
    drop(data);
    storage.save_sync();
    serde_json::json!({"success": true})
}

#[tauri::command]
pub fn delete_multiple(storage: State<StorageState>, ids: Vec<String>) -> serde_json::Value {
    let mut data = storage.data.lock().unwrap();
    data.items.retain(|i| !ids.contains(&i.id));
    drop(data);
    storage.save_sync();
    serde_json::json!({"success": true})
}

#[tauri::command]
pub fn pin_item(storage: State<StorageState>, id: String) -> serde_json::Value {
    let mut data = storage.data.lock().unwrap();
    if let Some(item) = data.items.iter_mut().find(|i| i.id == id) {
        item.pinned = !item.pinned;
        let pinned = item.pinned;
        drop(data);
        storage.save_sync();
        serde_json::json!({"success": true, "pinned": pinned})
    } else {
        serde_json::json!({"success": false})
    }
}

#[tauri::command]
pub fn move_to_tab(
    storage: State<StorageState>,
    item_id: String,
    tab_id: String,
) -> serde_json::Value {
    let mut data = storage.data.lock().unwrap();
    if let Some(item) = data.items.iter_mut().find(|i| i.id == item_id) {
        item.tab_id = Some(tab_id);
        drop(data);
        storage.save_sync();
        serde_json::json!({"success": true})
    } else {
        serde_json::json!({"success": false})
    }
}

#[tauri::command]
pub fn label_item(
    storage: State<StorageState>,
    id: String,
    label: String,
) -> serde_json::Value {
    let mut data = storage.data.lock().unwrap();
    if let Some(item) = data.items.iter_mut().find(|i| i.id == id) {
        item.label = label;
        drop(data);
        storage.save_sync();
        serde_json::json!({"success": true})
    } else {
        serde_json::json!({"success": false})
    }
}

#[tauri::command]
pub fn copy_to_clipboard(_storage: State<StorageState>, content: String) -> serde_json::Value {
    match Clipboard::new() {
        Ok(mut clipboard) => {
            if let Err(e) = clipboard.set_text(&content) {
                error!("Failed to set clipboard text: {}", e);
                return serde_json::json!({"success": false});
            }
            serde_json::json!({"success": true})
        }
        Err(e) => {
            error!("Failed to open clipboard: {}", e);
            serde_json::json!({"success": false})
        }
    }
}

#[tauri::command]
pub fn copy_image_to_clipboard(base64: String) -> serde_json::Value {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use arboard::ImageData;
    
    // Remove "data:image/png;base64," if present
    let b64 = if let Some(stripped) = base64.strip_prefix("data:image/png;base64,") {
        stripped
    } else {
        &base64
    };

    match STANDARD.decode(b64) {
        Ok(buf) => {
            if let Ok(img) = image::load_from_memory(&buf) {
                let rgba = img.to_rgba8();
                let (width, height) = rgba.dimensions();
                let img_data = ImageData {
                    width: width as usize,
                    height: height as usize,
                    bytes: rgba.into_raw().into(),
                };
                
                if let Ok(mut clipboard) = Clipboard::new() {
                    if let Err(e) = clipboard.set_image(img_data) {
                        error!("Failed to copy image to clipboard: {}", e);
                        return serde_json::json!({"success": false});
                    }
                    return serde_json::json!({"success": true});
                }
            }
        },
        Err(e) => {
            error!("Failed to decode base64 image: {}", e);
        }
    }
    serde_json::json!({"success": false})
}

#[tauri::command]
pub fn bulk_copy(storage: State<StorageState>, contents: Vec<String>) -> serde_json::Value {
    let data = storage.data.lock().unwrap();
    let delim = data
        .settings
        .paste_delimiter
        .replace("\\n", "\n")
        .replace("\\t", "\t");
    drop(data);

    let combined = contents.join(&delim);
    match Clipboard::new() {
        Ok(mut clipboard) => {
            if let Err(e) = clipboard.set_text(&combined) {
                error!("Failed to bulk copy: {}", e);
                return serde_json::json!({"success": false});
            }
            serde_json::json!({"success": true})
        }
        Err(e) => {
            error!("Failed to open clipboard for bulk copy: {}", e);
            serde_json::json!({"success": false})
        }
    }
}

#[tauri::command]
pub fn paste_and_hide(
    app_handle: AppHandle,
    storage: State<StorageState>,
    content: String,
    image_path: Option<String>,
) -> serde_json::Value {
    // Hide popup first
    if let Some(window) = app_handle.get_webview_window("main") {
        window.hide().ok();
    }

    // Paste in a separate thread to not block
    let images_dir = storage.images_dir().to_path_buf();
    std::thread::spawn(move || {
        if let Some(ref img_path) = image_path {
            let full_path = images_dir.join(img_path);
            paste::paste_image_and_simulate(&full_path);
        } else {
            paste::paste_text_and_simulate(&content);
        }
    });

    serde_json::json!({"success": true})
}

#[tauri::command]
pub fn bulk_paste_and_hide(
    app_handle: AppHandle,
    storage: State<StorageState>,
    contents: Vec<String>,
) -> serde_json::Value {
    let data = storage.data.lock().unwrap();
    let delim = data.settings.paste_delimiter.clone();
    drop(data);

    // Hide popup
    if let Some(window) = app_handle.get_webview_window("main") {
        window.hide().ok();
    }

    std::thread::spawn(move || {
        paste::bulk_paste_text_and_simulate(&contents, &delim);
    });

    serde_json::json!({"success": true})
}

#[tauri::command]
pub fn hide_popup(app_handle: AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        window.hide().ok();
    }
}

#[tauri::command]
pub fn clear_history(
    storage: State<StorageState>,
    tab_id: Option<String>,
) -> serde_json::Value {
    let mut data = storage.data.lock().unwrap();
    if let Some(ref tid) = tab_id {
        if tid != "all" {
            data.items.retain(|i| i.tab_id.as_deref() != Some(tid.as_str()) || i.pinned);
        } else {
            data.items.retain(|i| i.pinned);
        }
    } else {
        data.items.retain(|i| i.pinned);
    }
    drop(data);
    storage.save_sync();
    serde_json::json!({"success": true})
}

#[tauri::command]
pub fn get_stats(storage: State<StorageState>) -> Stats {
    let data = storage.data.lock().unwrap();
    let storage_size = std::fs::metadata(storage.db_path())
        .map(|m| m.len())
        .unwrap_or(0);
    Stats {
        total_items: data.items.len(),
        pinned_items: data.items.iter().filter(|i| i.pinned).count(),
        storage_size,
    }
}

// ============ SETTINGS ============

#[tauri::command]
pub fn get_settings(storage: State<StorageState>) -> crate::models::Settings {
    let data = storage.data.lock().unwrap();
    data.settings.clone()
}

#[tauri::command]
pub fn set_settings(
    storage: State<StorageState>,
    settings: serde_json::Value,
) -> serde_json::Value {
    let mut data = storage.data.lock().unwrap();

    // Merge settings
    if let Some(theme) = settings.get("theme").and_then(|v| v.as_str()) {
        data.settings.theme = theme.to_string();
    }
    if let Some(max) = settings.get("maxHistory").and_then(|v| v.as_u64()) {
        data.settings.max_history = max as usize;
    }
    if let Some(sc) = settings.get("shortcutToggle").and_then(|v| v.as_str()) {
        data.settings.shortcut_toggle = sc.to_string();
    }
    if let Some(delim) = settings.get("pasteDelimiter").and_then(|v| v.as_str()) {
        data.settings.paste_delimiter = delim.to_string();
    }
    if let Some(poll) = settings.get("pollInterval").and_then(|v| v.as_u64()) {
        data.settings.poll_interval = poll;
    }

    drop(data);
    storage.save_sync();
    serde_json::json!({"success": true})
}

// ============ WINDOW CONTROLS ============

#[tauri::command]
pub fn window_minimize(app_handle: AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        window.minimize().ok();
    }
}

#[tauri::command]
pub fn window_close(app_handle: AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        window.hide().ok();
    }
}

#[tauri::command]
pub fn window_quit(app_handle: AppHandle) {
    app_handle.exit(0);
}

#[tauri::command]
pub fn window_fullscreen(app_handle: AppHandle, fullscreen: bool) {
    if let Some(window) = app_handle.get_webview_window("main") {
        window.set_fullscreen(fullscreen).ok();
    }
}

// ============ VERSION ============

#[tauri::command]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ============ UPDATE STUBS ============

#[tauri::command]
pub fn check_for_update(app_handle: AppHandle) -> serde_json::Value {
    // Stub: updater not configured yet
    app_handle.emit("update-status", serde_json::json!({"status": "up-to-date"})).ok();
    serde_json::json!({"status": "ok"})
}

#[tauri::command]
pub fn install_update() -> serde_json::Value {
    // Stub
    serde_json::json!({"status": "no-update"})
}

/// Get the asset protocol URL for an image path
#[tauri::command]
pub fn get_image_url(storage: State<StorageState>, filename: String) -> String {
    let full_path = storage.images_dir().join(&filename);
    if full_path.exists() {
        // Return file:// URL for the image
        format!("asset://localhost/{}", full_path.to_string_lossy().replace('\\', "/"))
    } else {
        String::new()
    }
}

// ============ SCREEN CAPTURE ============

#[tauri::command]
pub fn capture_screen() -> Result<String, String> {
    use xcap::Monitor;
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use std::io::Cursor;

    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    // For simplicity, capture the primary monitor or the first one
    if let Some(monitor) = monitors.first() {
        let image = monitor.capture_image().map_err(|e| e.to_string())?;
        
        let mut buffer = Cursor::new(Vec::new());
        image.write_to(&mut buffer, image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
            
        let base64_str = STANDARD.encode(buffer.into_inner());
        Ok(format!("data:image/png;base64,{}", base64_str))
    } else {
        Err("No monitor found".to_string())
    }
}

// ============ VAULT ============

/// Simple hash for vault PIN (not crypto-grade, but sufficient for local app lock)
fn simple_hash(pin: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    pin.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

#[tauri::command]
pub fn set_vault_pin(storage: State<StorageState>, pin: String) -> serde_json::Value {
    let mut data = storage.data.lock().unwrap();
    data.settings.vault_pin_hash = simple_hash(&pin);
    drop(data);
    storage.save_sync();
    serde_json::json!({"success": true})
}

#[tauri::command]
pub fn verify_vault_pin(storage: State<StorageState>, pin: String) -> serde_json::Value {
    let data = storage.data.lock().unwrap();
    let valid = data.settings.vault_pin_hash == simple_hash(&pin);
    serde_json::json!({"valid": valid})
}

#[tauri::command]
pub fn has_vault_pin(storage: State<StorageState>) -> serde_json::Value {
    let data = storage.data.lock().unwrap();
    serde_json::json!({"hasPin": !data.settings.vault_pin_hash.is_empty()})
}

#[tauri::command]
pub fn move_to_vault(storage: State<StorageState>, id: String) -> serde_json::Value {
    let mut data = storage.data.lock().unwrap();
    if let Some(item) = data.items.iter_mut().find(|i| i.id == id) {
        item.in_vault = true;
        drop(data);
        storage.save_sync();
        serde_json::json!({"success": true})
    } else {
        serde_json::json!({"success": false, "error": "Item not found"})
    }
}

#[tauri::command]
pub fn remove_from_vault(storage: State<StorageState>, id: String) -> serde_json::Value {
    let mut data = storage.data.lock().unwrap();
    if let Some(item) = data.items.iter_mut().find(|i| i.id == id) {
        item.in_vault = false;
        drop(data);
        storage.save_sync();
        serde_json::json!({"success": true})
    } else {
        serde_json::json!({"success": false, "error": "Item not found"})
    }
}

#[tauri::command]
pub fn get_vault_items(storage: State<StorageState>) -> serde_json::Value {
    let data = storage.data.lock().unwrap();
    let vault_items: Vec<&crate::models::Item> = data.items.iter().filter(|i| i.in_vault).collect();
    serde_json::json!({"items": vault_items})
}
