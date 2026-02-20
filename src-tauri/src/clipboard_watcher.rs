use crate::models::{Item, ItemKind};
use crate::storage::Storage;
use arboard::Clipboard;
use image::ImageEncoder;
use log::{error, info, warn};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Detect content category heuristic
pub fn detect_category(text: &str) -> &'static str {
    let t = text.trim();
    if t.is_empty() {
        return "text";
    }

    // URL
    if t.starts_with("http://") || t.starts_with("https://") || t.starts_with("www.") {
        if !t.contains(char::is_whitespace) {
            return "link";
        }
    }

    // Email
    if !t.contains(char::is_whitespace) && t.contains('@') && t.contains('.') {
        let parts: Vec<&str> = t.split('@').collect();
        if parts.len() == 2 && !parts[0].is_empty() && parts[1].contains('.') {
            return "email";
        }
    }

    // Phone
    let cleaned: String = t.chars().filter(|c| c.is_ascii_digit()).collect();
    if (7..=15).contains(&cleaned.len()) && t.chars().all(|c| "0123456789 -+().".contains(c)) {
        return "phone";
    }

    // Code detection
    let code_indicators = ["{", "}", "[", "]", "()", ";", "=>", "->", "fn ", "def ", "class ", "const ", "let ", "var ", "function ", "import ", "pub "];
    let indicator_count = code_indicators.iter().filter(|ind| text.contains(*ind)).count();
    if indicator_count >= 2 {
        return "code";
    }

    // Contains URLs but has other content too
    if text.contains("http://") || text.contains("https://") {
        return "link";
    }

    "text"
}

/// Start clipboard monitoring in a background task
pub fn start_clipboard_watcher(app_handle: AppHandle, storage: Arc<Storage>) {
    let poll_ms = {
        let data = storage.data.lock().unwrap();
        data.settings.poll_interval
    };

    std::thread::spawn(move || {
        let mut clipboard = match Clipboard::new() {
            Ok(c) => c,
            Err(e) => {
                error!("Failed to access clipboard: {}", e);
                return;
            }
        };

        let mut last_text_hash: Option<Vec<u8>> = None;
        let mut last_image_hash: Option<Vec<u8>> = None;

        // Get initial clipboard text hash
        if let Ok(text) = clipboard.get_text() {
            if !text.is_empty() {
                let mut hasher = Sha256::new();
                hasher.update(text.as_bytes());
                last_text_hash = Some(hasher.finalize().to_vec());
            }
        }

        info!("Clipboard watcher started, polling every {}ms", poll_ms);

        loop {
            std::thread::sleep(Duration::from_millis(poll_ms));

            // Check text
            if let Ok(text) = clipboard.get_text() {
                if !text.is_empty() {
                    let mut hasher = Sha256::new();
                    hasher.update(text.as_bytes());
                    let hash = hasher.finalize().to_vec();

                    if last_text_hash.as_ref() != Some(&hash) {
                        last_text_hash = Some(hash);
                        let category = detect_category(&text);
                        let tab_id = if category == "link" {
                            Some("links".to_string())
                        } else {
                            None
                        };
                        let id = format!(
                            "{}{}",
                            chrono::Utc::now().timestamp_millis(),
                            &uuid::Uuid::new_v4().to_string()[..8]
                        );
                        let item = Item {
                            id,
                            kind: ItemKind::Text,
                            content_text: Some(text.clone()),
                            image_path: None,
                            mime: None,
                            category: category.to_string(),
                            tab_id,
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            pinned: false,
                            label: String::new(),
                            content: Some(text),
                            in_vault: false,
                        };

                        // Add to storage
                        {
                            let mut data = storage.data.lock().unwrap();
                            data.items.insert(0, item.clone());
                            // Trim
                            let max = data.settings.max_history;
                            if data.items.len() > max {
                                let pinned: Vec<Item> =
                                    data.items.iter().filter(|i| i.pinned).cloned().collect();
                                let unpinned: Vec<Item> =
                                    data.items.iter().filter(|i| !i.pinned).cloned().collect();
                                let mut new_items = pinned;
                                new_items.extend(unpinned.into_iter().take(max));
                                data.items = new_items;
                            }
                        }
                        storage.save_sync();

                        // Emit event
                        if let Err(e) = app_handle.emit("clipboard-updated", &item) {
                            warn!("Failed to emit clipboard-updated: {}", e);
                        }
                    }
                }
            }

            // Check image
            match clipboard.get_image() {
                Ok(img_data) => {
                    if !img_data.bytes.is_empty() {
                        let mut hasher = Sha256::new();
                        hasher.update(&img_data.bytes);
                        let hash = hasher.finalize().to_vec();

                        if last_image_hash.as_ref() != Some(&hash) {
                            last_image_hash = Some(hash);

                            // Save image to file
                            let id = format!(
                                "{}{}",
                                chrono::Utc::now().timestamp_millis(),
                                &uuid::Uuid::new_v4().to_string()[..8]
                            );
                            let filename = format!("{}.png", &id);
                            let img_path = storage.images_dir().join(&filename);

                            // Convert RGBA to PNG
                            match save_image_data(
                                &img_data.bytes,
                                img_data.width,
                                img_data.height,
                                &img_path,
                            ) {
                                Ok(_) => {
                                    let item = Item {
                                        id,
                                        kind: ItemKind::Image,
                                        content_text: None,
                                        image_path: Some(filename),
                                        mime: Some("image/png".into()),
                                        category: "image".into(),
                                        tab_id: None,
                                        timestamp: chrono::Utc::now().to_rfc3339(),
                                        pinned: false,
                                        label: String::new(),
                                        content: None,
                                        in_vault: false,
                                    };

                                    {
                                        let mut data = storage.data.lock().unwrap();
                                        data.items.insert(0, item.clone());
                                        let max = data.settings.max_history;
                                        if data.items.len() > max {
                                            let pinned: Vec<Item> = data
                                                .items
                                                .iter()
                                                .filter(|i| i.pinned)
                                                .cloned()
                                                .collect();
                                            let unpinned: Vec<Item> = data
                                                .items
                                                .iter()
                                                .filter(|i| !i.pinned)
                                                .cloned()
                                                .collect();
                                            let mut new_items = pinned;
                                            new_items.extend(unpinned.into_iter().take(max));
                                            data.items = new_items;
                                        }
                                    }
                                    storage.save_sync();

                                    if let Err(e) = app_handle.emit("clipboard-updated", &item) {
                                        warn!("Failed to emit clipboard-updated: {}", e);
                                    }
                                }
                                Err(e) => {
                                    warn!("Failed to save clipboard image: {}", e);
                                }
                            }
                        }
                    }
                }
                Err(_) => {
                    // No image in clipboard, that's normal
                }
            }
        }
    });
}

fn save_image_data(
    rgba_bytes: &[u8],
    width: usize,
    height: usize,
    path: &std::path::Path,
) -> Result<(), String> {
    let file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let writer = std::io::BufWriter::new(file);
    let encoder = image::codecs::png::PngEncoder::new(writer);
    encoder
        .write_image(rgba_bytes, width as u32, height as u32, image::ColorType::Rgba8.into())
        .map_err(|e| e.to_string())?;
    Ok(())
}
