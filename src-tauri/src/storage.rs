use crate::models::{AppData, Item, ItemKind};
use log::{error, info, warn};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Storage manages the persisted JSON data file
pub struct Storage {
    pub data: Mutex<AppData>,
    db_path: PathBuf,
    images_dir: PathBuf,
}

impl Storage {
    /// Create storage, loading existing data or defaults
    pub fn new(app_data_dir: &Path) -> Self {
        let db_path = app_data_dir.join("copas-db.json");
        let images_dir = app_data_dir.join("images");

        // Ensure dirs exist
        fs::create_dir_all(app_data_dir).ok();
        fs::create_dir_all(&images_dir).ok();

        let data = if db_path.exists() {
            match fs::read_to_string(&db_path) {
                Ok(content) => match serde_json::from_str::<AppData>(&content) {
                    Ok(data) => {
                        info!("Loaded existing database from {:?}", db_path);
                        data
                    }
                    Err(e) => {
                        error!("Failed to parse database: {}, using defaults", e);
                        // Backup corrupted file
                        let backup = db_path.with_extension("json.bak");
                        fs::copy(&db_path, &backup).ok();
                        AppData::default()
                    }
                },
                Err(e) => {
                    error!("Failed to read database: {}, using defaults", e);
                    AppData::default()
                }
            }
        } else {
            info!("No database found, creating with defaults");
            let mut data = AppData::default();
            // Try to migrate from Electron
            if let Some(migrated) = Self::try_migrate_from_electron(app_data_dir) {
                info!("Migrated {} items from Electron database", migrated.items.len());
                data = migrated;
                data.migrated_from_electron = true;
            }
            data
        };

        let storage = Self {
            data: Mutex::new(data),
            db_path,
            images_dir,
        };
        storage.save_sync();
        storage
    }

    /// Get the images directory path
    pub fn images_dir(&self) -> &Path {
        &self.images_dir
    }

    /// Get the db file path
    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    /// Save data to disk (atomic write: write to tmp then rename)
    pub fn save_sync(&self) {
        let data = self.data.lock().unwrap();
        let tmp_path = self.db_path.with_extension("json.tmp");

        match serde_json::to_string_pretty(&*data) {
            Ok(json) => {
                if let Err(e) = fs::write(&tmp_path, &json) {
                    error!("Failed to write temp db file: {}", e);
                    return;
                }
                if let Err(e) = fs::rename(&tmp_path, &self.db_path) {
                    error!("Failed to rename temp db file: {}", e);
                    // Fallback: try direct write
                    fs::write(&self.db_path, &json).ok();
                }
            }
            Err(e) => {
                error!("Failed to serialize data: {}", e);
            }
        }
    }

    /// Try to find and migrate data from former Electron app
    fn try_migrate_from_electron(app_data_dir: &Path) -> Option<AppData> {
        let electron_paths = Self::get_electron_data_paths();

        for path in electron_paths {
            let electron_db = path.join("copas-data.json");
            if electron_db.exists() {
                info!("Found Electron database at {:?}", electron_db);
                match fs::read_to_string(&electron_db) {
                    Ok(content) => {
                        // Try to parse. The Electron schema uses "content" field
                        // instead of "content_text", but serde can handle both
                        match serde_json::from_str::<AppData>(&content) {
                            Ok(mut data) => {
                                // Convert legacy items: if item has "content" but no "content_text"
                                for item in &mut data.items {
                                    if item.content_text.is_none() && item.content.is_some() {
                                        item.content_text = item.content.clone();
                                        item.kind = ItemKind::Text;
                                    }
                                    if item.kind != ItemKind::Image && item.kind != ItemKind::Text {
                                        item.kind = ItemKind::Text;
                                    }
                                }
                                return Some(data);
                            }
                            Err(e) => {
                                warn!("Failed to parse Electron database: {}", e);
                                // Try a more lenient parse
                                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content)
                                {
                                    return Self::migrate_from_value(val);
                                }
                            }
                        }
                    }
                    Err(e) => {
                        warn!("Failed to read Electron database: {}", e);
                    }
                }
            }
        }
        None
    }

    /// Migrate from a raw JSON Value (lenient parse for old Electron data)
    fn migrate_from_value(val: serde_json::Value) -> Option<AppData> {
        let mut data = AppData::default();

        // Tabs
        if let Some(tabs) = val.get("tabs").and_then(|t| t.as_array()) {
            data.tabs = tabs
                .iter()
                .filter_map(|t| serde_json::from_value(t.clone()).ok())
                .collect();
            if data.tabs.is_empty() {
                data.tabs = AppData::default().tabs;
            }
        }

        // Items
        if let Some(items) = val.get("items").and_then(|i| i.as_array()) {
            for item_val in items {
                let id = item_val
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let content = item_val
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let category = item_val
                    .get("category")
                    .and_then(|v| v.as_str())
                    .unwrap_or("text")
                    .to_string();
                let tab_id = item_val
                    .get("tabId")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let timestamp = item_val
                    .get("timestamp")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let pinned = item_val
                    .get("pinned")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let label = item_val
                    .get("label")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                if !id.is_empty() {
                    data.items.push(Item {
                        id,
                        kind: ItemKind::Text,
                        content_text: Some(content.clone()),
                        image_path: None,
                        mime: None,
                        category,
                        tab_id,
                        timestamp,
                        pinned,
                        label,
                        content: Some(content),
                    });
                }
            }
        }

        // Settings
        if let Some(settings_val) = val.get("settings") {
            if let Ok(settings) = serde_json::from_value(settings_val.clone()) {
                data.settings = settings;
            }
        }

        if data.items.is_empty() && data.tabs.len() <= 3 {
            return None; // Nothing worth migrating
        }
        Some(data)
    }

    /// Get possible Electron app data directories
    fn get_electron_data_paths() -> Vec<PathBuf> {
        let mut paths = vec![];

        #[cfg(target_os = "macos")]
        {
            if let Some(home) = dirs::home_dir() {
                paths.push(home.join("Library/Application Support/copas"));
                paths.push(home.join("Library/Application Support/CoPas"));
                paths.push(home.join("Library/Application Support/com.copas.clipboard-manager"));
            }
        }

        #[cfg(target_os = "windows")]
        {
            if let Some(appdata) = dirs::data_dir() {
                paths.push(appdata.join("copas"));
                paths.push(appdata.join("CoPas"));
                paths.push(appdata.join("com.copas.clipboard-manager"));
            }
        }

        paths
    }
}
