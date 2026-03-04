use arboard::Clipboard;
use log::{error, info, warn};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

/// Global flag: when true, clipboard watcher should skip the next change
pub static PASTE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

/// Hash of the last content we pasted — watcher should skip this
pub static LAST_PASTE_HASH: once_cell::sync::Lazy<Mutex<Option<Vec<u8>>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

// ─── Text paste ───────────────────────────────────────────────────────────────

/// Write text to clipboard and simulate paste via 3 reliable steps:
///   1. pbcopy (macOS) or arboard (other) to set clipboard
///   2. osascript to activate target app
///   3. osascript to send Cmd+V
pub fn paste_text_and_simulate(text: &str) {
    info!("paste_text: len={}", text.len());
    PASTE_IN_PROGRESS.store(true, Ordering::SeqCst);
    save_paste_hash(text);

    #[cfg(target_os = "macos")]
    {
        let prev_app = get_previous_app();
        macos_set_clipboard_text(text);
        macos_activate_app(&prev_app);
        thread::sleep(Duration::from_millis(300));
        macos_send_paste();
    }

    #[cfg(not(target_os = "macos"))]
    {
        set_clipboard_arboard(text);
        activate_and_paste();
    }

    thread::sleep(Duration::from_millis(2000));
    PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
}

// ─── Rich text paste ──────────────────────────────────────────────────────────

/// Paste text WITH HTML formatting (bold, italic, colors)
/// Sets both plain text and HTML on macOS clipboard via NSPasteboard
pub fn paste_rich_text_and_simulate(text: &str, html: &str) {
    info!("paste_rich: text_len={}, html_len={}", text.len(), html.len());
    PASTE_IN_PROGRESS.store(true, Ordering::SeqCst);
    save_paste_hash(text);

    #[cfg(target_os = "macos")]
    {
        let prev_app = get_previous_app();

        // Try NSPasteboard to set both HTML + text
        let html_tmp = "/tmp/copas_paste_html.html";
        let text_tmp = "/tmp/copas_paste_text.txt";

        let rich_ok = if std::fs::write(html_tmp, html).is_ok()
            && std::fs::write(text_tmp, text).is_ok()
        {
            let script = r#"
                use framework "AppKit"
                set htmlContent to read (POSIX file "/tmp/copas_paste_html.html") as «class utf8»
                set textContent to read (POSIX file "/tmp/copas_paste_text.txt") as «class utf8»
                set pb to current application's NSPasteboard's generalPasteboard()
                pb's clearContents()
                pb's setString:textContent forType:(current application's NSPasteboardTypeString)
                pb's setString:htmlContent forType:(current application's NSPasteboardTypeHTML)
                return "OK"
            "#;
            let result = std::process::Command::new("osascript")
                .arg("-l").arg("AppleScript")
                .arg("-e").arg(script)
                .output();
            match result {
                Ok(out) if out.status.success() => {
                    info!("paste_rich: NSPasteboard HTML+text OK");
                    true
                }
                Ok(out) => {
                    let e = String::from_utf8_lossy(&out.stderr);
                    warn!("paste_rich: NSPasteboard failed: {}", e);
                    false
                }
                Err(e) => { warn!("paste_rich: osascript error: {}", e); false }
            }
        } else {
            false
        };

        // Cleanup temp files
        let _ = std::fs::remove_file(html_tmp);
        let _ = std::fs::remove_file(text_tmp);

        // If rich clipboard failed, fallback to plain text via pbcopy
        if !rich_ok {
            info!("paste_rich: falling back to plain text");
            macos_set_clipboard_text(text);
        }

        macos_activate_app(&prev_app);
        thread::sleep(Duration::from_millis(300));
        macos_send_paste();
    }

    #[cfg(not(target_os = "macos"))]
    {
        set_clipboard_arboard(text);
        activate_and_paste();
    }

    thread::sleep(Duration::from_millis(2000));
    PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
}

// ─── Image paste ──────────────────────────────────────────────────────────────

/// Write image to clipboard and simulate paste
pub fn paste_image_and_simulate(image_path: &Path) {
    info!("paste_image: {:?}", image_path);
    PASTE_IN_PROGRESS.store(true, Ordering::SeqCst);

    let img = match image::open(image_path) {
        Ok(img) => img,
        Err(e) => {
            error!("paste_image: open failed: {}", e);
            PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
            return;
        }
    };

    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let bytes = rgba.into_raw();

    let mut clipboard = match Clipboard::new() {
        Ok(c) => c,
        Err(e) => {
            error!("paste_image: clipboard open failed: {}", e);
            PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
            return;
        }
    };

    let img_data = arboard::ImageData {
        width: width as usize,
        height: height as usize,
        bytes: std::borrow::Cow::Owned(bytes),
    };

    if let Err(e) = clipboard.set_image(img_data) {
        error!("paste_image: set_image failed: {}", e);
        PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
        return;
    }
    drop(clipboard);
    info!("paste_image: clipboard set {}x{}", width, height);

    activate_and_paste();

    thread::sleep(Duration::from_millis(2000));
    PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
}

// ─── Bulk paste ───────────────────────────────────────────────────────────────

/// Bulk paste text items combined with a delimiter
pub fn bulk_paste_text_and_simulate(contents: &[String], delimiter: &str) {
    let resolved_delim = delimiter.replace("\\n", "\n").replace("\\t", "\t");
    let combined = contents.join(&resolved_delim);
    paste_text_and_simulate(&combined);
}

/// Bulk paste mixed content (text + images) sequentially
pub fn bulk_paste_mixed(items: &[(Option<String>, Option<String>, Option<String>)]) {
    info!("bulk_paste_mixed: {} items", items.len());

    for (i, (text, html, image_path)) in items.iter().enumerate() {
        info!("bulk_paste_mixed: item {}/{}", i + 1, items.len());

        if let Some(img_path) = image_path {
            paste_image_and_simulate(Path::new(img_path));
        } else if let Some(text) = text {
            if let Some(html) = html {
                if !html.is_empty() {
                    paste_rich_text_and_simulate(text, html);
                } else {
                    paste_text_and_simulate(text);
                }
            } else {
                paste_text_and_simulate(text);
            }
        }

        // Delay between items
        if i < items.len() - 1 {
            thread::sleep(Duration::from_millis(500));
        }
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn save_paste_hash(text: &str) {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    let hash = hasher.finalize().to_vec();
    if let Ok(mut lph) = LAST_PASTE_HASH.lock() {
        *lph = Some(hash);
    }
}

fn get_previous_app() -> String {
    crate::PREVIOUS_APP_NAME
        .lock()
        .map(|n| n.clone())
        .unwrap_or_default()
}

/// Set clipboard text via pbcopy (macOS only, proven reliable)
#[cfg(target_os = "macos")]
fn macos_set_clipboard_text(text: &str) {
    use std::io::Write;
    let mut child = match std::process::Command::new("pbcopy")
        .stdin(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            error!("pbcopy spawn failed: {}", e);
            return;
        }
    };
    if let Some(ref mut stdin) = child.stdin {
        if let Err(e) = stdin.write_all(text.as_bytes()) {
            error!("pbcopy write failed: {}", e);
            return;
        }
    }
    drop(child.stdin.take());
    let _ = child.wait();
    info!("pbcopy OK");
}

/// Activate app by name via osascript
#[cfg(target_os = "macos")]
fn macos_activate_app(app_name: &str) {
    if app_name.is_empty() {
        warn!("no previous app to activate");
        // Try to activate most recent non-CoPas app
        let _ = std::process::Command::new("osascript")
            .arg("-e")
            .arg(r#"tell application "System Events"
                set appList to every process whose visible is true and name is not "CoPas" and name is not "copas"
                if (count of appList) > 0 then
                    set frontmost of item 1 of appList to true
                end if
            end tell"#)
            .output();
        return;
    }
    let result = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&format!(r#"tell application "{}" to activate"#, app_name))
        .output();
    match result {
        Ok(out) if out.status.success() => info!("activate '{}' OK", app_name),
        Ok(out) => {
            let e = String::from_utf8_lossy(&out.stderr);
            warn!("activate '{}' failed: {}", app_name, e);
        }
        Err(e) => warn!("activate osascript error: {}", e),
    }
}

/// Send Cmd+V keystroke via osascript, with CGEvent fallback
#[cfg(target_os = "macos")]
fn macos_send_paste() {
    let result = std::process::Command::new("osascript")
        .arg("-e")
        .arg(r#"tell application "System Events" to keystroke "v" using command down"#)
        .output();
    match result {
        Ok(out) if out.status.success() => {
            info!("keystroke Cmd+V OK");
        }
        _ => {
            warn!("keystroke failed, trying CGEvent...");
            if try_cgevent_paste() {
                info!("CGEvent paste OK");
            } else {
                error!("ALL paste methods failed");
            }
        }
    }
}

/// Set clipboard via arboard (cross-platform fallback)
#[allow(dead_code)]
fn set_clipboard_arboard(text: &str) {
    let mut clipboard = match Clipboard::new() {
        Ok(c) => c,
        Err(e) => { error!("clipboard open failed: {}", e); return; }
    };
    if let Err(e) = clipboard.set_text(text) {
        error!("set_text failed: {}", e);
        return;
    }
    drop(clipboard);
}

/// Activate previous app and paste (image path, non-macOS text)
fn activate_and_paste() {
    #[cfg(target_os = "macos")]
    {
        let prev_app = get_previous_app();
        macos_activate_app(&prev_app);
        thread::sleep(Duration::from_millis(300));
        macos_send_paste();
    }

    #[cfg(not(target_os = "macos"))]
    {
        thread::sleep(Duration::from_millis(300));
        simulate_paste_enigo();
    }
}

/// CGEvent based Cmd+V (lower-level, requires Accessibility)
#[cfg(target_os = "macos")]
fn try_cgevent_paste() -> bool {
    use core_graphics::event::{CGEvent, CGEventFlags, CGKeyCode};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use core_graphics::event::CGEventTapLocation;

    const V_KEY: CGKeyCode = 9;

    let source = match CGEventSource::new(CGEventSourceStateID::HIDSystemState) {
        Ok(s) => s,
        Err(_) => { warn!("CGEventSource failed — no Accessibility"); return false; }
    };

    let key_down = match CGEvent::new_keyboard_event(source.clone(), V_KEY, true) {
        Ok(e) => e,
        Err(_) => return false,
    };
    key_down.set_flags(CGEventFlags::CGEventFlagCommand);

    let key_up = match CGEvent::new_keyboard_event(source, V_KEY, false) {
        Ok(e) => e,
        Err(_) => return false,
    };
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);

    key_down.post(CGEventTapLocation::HID);
    thread::sleep(Duration::from_millis(50));
    key_up.post(CGEventTapLocation::HID);
    true
}

/// Check if Accessibility permission is granted
#[cfg(target_os = "macos")]
pub fn check_accessibility() -> bool {
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    CGEventSource::new(CGEventSourceStateID::HIDSystemState).is_ok()
}

/// Windows/Linux: enigo for Ctrl+V
#[cfg(not(target_os = "macos"))]
fn simulate_paste_enigo() {
    use enigo::{Enigo, Key, Keyboard, Settings};

    let mut enigo = match Enigo::new(&Settings::default()) {
        Ok(e) => e,
        Err(e) => { error!("enigo failed: {}", e); return; }
    };

    enigo.key(Key::Control, enigo::Direction::Press).ok();
    thread::sleep(Duration::from_millis(30));
    enigo.key(Key::Unicode('v'), enigo::Direction::Click).ok();
    thread::sleep(Duration::from_millis(30));
    enigo.key(Key::Control, enigo::Direction::Release).ok();
}
