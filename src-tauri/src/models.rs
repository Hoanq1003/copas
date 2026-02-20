use serde::{Deserialize, Serialize};

/// A tab/category for organizing clipboard items
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tab {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub system: bool,
}

/// The kind of clipboard item
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Text,
    Image,
}

/// A clipboard history item
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub kind: ItemKind,
    /// Text content (for text items) or empty
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_text: Option<String>,
    /// Relative path to saved image (for image items)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
    /// MIME type
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime: Option<String>,
    /// Category: text, link, email, phone, code, image
    pub category: String,
    /// Which tab this item belongs to (null = no specific tab)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<String>,
    /// ISO 8601 timestamp
    pub timestamp: String,
    pub pinned: bool,
    #[serde(default)]
    pub label: String,
    /// Legacy: for backward compat with Electron data
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

impl Item {
    /// Get displayable text content (for legacy compat)
    pub fn get_text(&self) -> &str {
        self.content_text
            .as_deref()
            .or(self.content.as_deref())
            .unwrap_or("")
    }
}

/// Application settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_max_history")]
    pub max_history: usize,
    #[serde(default = "default_shortcut_toggle")]
    pub shortcut_toggle: String,
    #[serde(default = "default_shortcut_paste")]
    pub shortcut_paste: String,
    #[serde(default = "default_poll_interval")]
    pub poll_interval: u64,
    #[serde(default = "default_true")]
    pub show_notifications: bool,
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default = "default_paste_delimiter")]
    pub paste_delimiter: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            max_history: default_max_history(),
            shortcut_toggle: default_shortcut_toggle(),
            shortcut_paste: default_shortcut_paste(),
            poll_interval: default_poll_interval(),
            show_notifications: true,
            auto_start: false,
            paste_delimiter: default_paste_delimiter(),
        }
    }
}

fn default_theme() -> String { "light".into() }
fn default_max_history() -> usize { 1000 }
fn default_shortcut_toggle() -> String {
    if cfg!(target_os = "macos") {
        "Cmd+Shift+V".into()
    } else {
        "Ctrl+Shift+V".into()
    }
}
fn default_shortcut_paste() -> String {
    if cfg!(target_os = "macos") {
        "Cmd+Shift+B".into()
    } else {
        "Ctrl+Shift+B".into()
    }
}
fn default_poll_interval() -> u64 { 500 }
fn default_true() -> bool { true }
fn default_paste_delimiter() -> String { "\\n".into() }

/// Root data structure persisted to JSON
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    pub tabs: Vec<Tab>,
    pub items: Vec<Item>,
    pub settings: Settings,
    #[serde(default)]
    pub migrated_from_electron: bool,
}

impl Default for AppData {
    fn default() -> Self {
        Self {
            tabs: vec![
                Tab { id: "all".into(), name: "Tất cả".into(), icon: "📋".into(), system: true },
                Tab { id: "links".into(), name: "Liên kết".into(), icon: "🔗".into(), system: true },
                Tab { id: "important".into(), name: "Quan trọng".into(), icon: "⭐".into(), system: false },
            ],
            items: vec![],
            settings: Settings::default(),
            migrated_from_electron: false,
        }
    }
}

/// Stats returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total_items: usize,
    pub pinned_items: usize,
    pub storage_size: u64,
}

/// History query result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryResult {
    pub items: Vec<Item>,
    pub total: usize,
}
