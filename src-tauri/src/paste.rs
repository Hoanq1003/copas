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

/// Write text to clipboard and simulate paste
pub fn paste_text_and_simulate(text: &str) {
    eprintln!(">>> paste_text_and_simulate CALLED, len={}", text.len());
    PASTE_IN_PROGRESS.store(true, Ordering::SeqCst);

    // Save hash so watcher won't re-add this content
    {
        let mut hasher = Sha256::new();
        hasher.update(text.as_bytes());
        let hash = hasher.finalize().to_vec();
        if let Ok(mut lph) = LAST_PASTE_HASH.lock() {
            *lph = Some(hash);
        }
    }

    #[cfg(target_os = "macos")]
    {
        let prev_app = {
            crate::PREVIOUS_APP_NAME.lock()
                .map(|n| n.clone())
                .unwrap_or_default()
        };
        eprintln!(">>> paste: prev_app='{}'", prev_app);

        // Write text to temp file to avoid shell escaping issues with osascript
        let tmp_file = "/tmp/copas_paste_content.txt";
        if let Err(e) = std::fs::write(tmp_file, text) {
            eprintln!(">>> paste: write temp file FAILED: {}", e);
            PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
            return;
        }

        // SINGLE ATOMIC osascript: read file → set clipboard → activate app → keystroke
        let script = if prev_app.is_empty() {
            // No previous app known — just set clipboard and paste to frontmost
            r#"
                set theText to read (POSIX file "/tmp/copas_paste_content.txt") as «class utf8»
                set the clipboard to theText
                delay 0.1
                tell application "System Events"
                    keystroke "v" using command down
                end tell
            "#.to_string()
        } else {
            format!(r#"
                set theText to read (POSIX file "/tmp/copas_paste_content.txt") as «class utf8»
                set the clipboard to theText
                delay 0.1
                tell application "{}" to activate
                delay 0.3
                tell application "System Events"
                    keystroke "v" using command down
                end tell
            "#, prev_app)
        };

        let result = std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output();

        match result {
            Ok(output) if output.status.success() => {
                eprintln!(">>> paste: atomic osascript (set+activate+paste) SUCCEEDED!");
                info!("paste: atomic osascript paste succeeded");
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                eprintln!(">>> paste: atomic osascript FAILED: {}", stderr);
                warn!("paste: atomic osascript failed: {}", stderr);
                // Fallback: try pbcopy + separate activate + CGEvent
                eprintln!(">>> paste: trying fallback...");
                use std::io::Write;
                if let Ok(mut child) = std::process::Command::new("pbcopy")
                    .stdin(std::process::Stdio::piped())
                    .spawn()
                {
                    if let Some(ref mut stdin) = child.stdin {
                        let _ = stdin.write_all(text.as_bytes());
                    }
                    let _ = child.wait();
                }
                activate_and_paste();
            }
            Err(e) => {
                eprintln!(">>> paste: osascript error: {}", e);
            }
        }

        // Cleanup temp file
        let _ = std::fs::remove_file(tmp_file);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let mut clipboard = match Clipboard::new() {
            Ok(c) => c,
            Err(e) => {
                eprintln!(">>> paste: clipboard open FAILED: {}", e);
                PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
                return;
            }
        };
        if let Err(e) = clipboard.set_text(text) {
            eprintln!(">>> paste: set_text FAILED: {}", e);
            PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
            return;
        }
        drop(clipboard);
        eprintln!(">>> paste: clipboard text set OK");
        activate_and_paste();
    }

    // Keep flag active for watcher to skip — 2s to be safe
    thread::sleep(Duration::from_millis(2000));
    PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
    eprintln!(">>> paste_text_and_simulate DONE");
}

/// Write image to clipboard and simulate paste
pub fn paste_image_and_simulate(image_path: &Path) {
    eprintln!(">>> paste_image_and_simulate CALLED: {:?}", image_path);
    PASTE_IN_PROGRESS.store(true, Ordering::SeqCst);

    let img = match image::open(image_path) {
        Ok(img) => img,
        Err(e) => {
            eprintln!(">>> paste: image open FAILED: {}", e);
            error!("paste: image open failed: {}", e);
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
            error!("paste: clipboard open for image failed: {}", e);
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
        error!("paste: clipboard set_image failed: {}", e);
        PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
        return;
    }
    drop(clipboard);
    eprintln!(">>> paste: clipboard image set OK, {}x{}", width, height);

    activate_and_paste();

    // Keep flag active for watcher to skip — 2s to be safe
    thread::sleep(Duration::from_millis(2000));
    PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
}

/// Activate the previous app and simulate paste keystroke
fn activate_and_paste() {
    #[cfg(target_os = "macos")]
    {
        macos_activate_and_paste();
    }

    #[cfg(not(target_os = "macos"))]
    {
        thread::sleep(Duration::from_millis(300));
        simulate_paste_enigo();
    }
}

/// macOS: Single atomic AppleScript approach
/// Instead of separate deactivate + activate + CGEvent calls,
/// do everything in ONE AppleScript call to avoid timing issues.
#[cfg(target_os = "macos")]
fn macos_activate_and_paste() {
    let prev_app = {
        crate::PREVIOUS_APP_NAME.lock()
            .map(|n| n.clone())
            .unwrap_or_default()
    };
    eprintln!(">>> macos_activate_and_paste: prev_app='{}'", prev_app);

    if prev_app.is_empty() {
        eprintln!(">>> No previous app saved! Trying generic approach...");
        warn!("paste: no previous app saved, trying generic paste");
        // Try to activate the most recent non-CoPas app
        let _ = std::process::Command::new("osascript")
            .arg("-e")
            .arg(r#"tell application "System Events"
                set appList to every process whose visible is true and name is not "CoPas" and name is not "copas"
                if (count of appList) > 0 then
                    set frontmost of item 1 of appList to true
                end if
            end tell"#)
            .output();
        // Try osascript keystroke first (doesn't need app name)
        eprintln!(">>> generic paste: trying osascript keystroke...");
        let paste_result = std::process::Command::new("osascript")
            .arg("-e")
            .arg(r#"tell application "System Events" to keystroke "v" using command down"#)
            .output();
        match paste_result {
            Ok(output) if output.status.success() => {
                eprintln!(">>> generic paste: osascript keystroke OK!");
            }
            _ => {
                eprintln!(">>> generic paste: osascript failed, trying CGEvent...");
                if try_cgevent_paste() {
                    eprintln!(">>> generic paste: CGEvent OK!");
                } else {
                    eprintln!(">>> generic paste: ALL methods FAILED");
                }
            }
        }
    }

    // Method 1: Single atomic AppleScript — activate + keystroke in one call
    // This is the most reliable because there's no timing gap between
    // activating the app and sending the keystroke.
    eprintln!(">>> Trying Method 1: Atomic AppleScript activate + keystroke...");
    let atomic_script = format!(
        r#"tell application "{}"
    activate
end tell
delay 0.5
tell application "System Events"
    keystroke "v" using command down
end tell"#,
        prev_app
    );

    let result = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&atomic_script)
        .output();

    match result {
        Ok(output) => {
            if output.status.success() {
                eprintln!(">>> Method 1 SUCCEEDED!");
                info!("paste: atomic AppleScript paste succeeded");
                return;
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                eprintln!(">>> Method 1 FAILED: {}", stderr);
                warn!("paste: atomic AppleScript failed: {}", stderr);
            }
        }
        Err(e) => {
            eprintln!(">>> Method 1 osascript ERROR: {}", e);
        }
    }

    // Method 2: Try CGEvent approach with explicit deactivation
    eprintln!(">>> Trying Method 2: Deactivate CoPas + activate + CGEvent...");

    // Deactivate CoPas
    let _ = std::process::Command::new("osascript")
        .arg("-e")
        .arg(r#"tell application "System Events"
            set visible of process "CoPas" to false
        end tell"#)
        .output();

    thread::sleep(Duration::from_millis(100));

    // Activate target
    let _ = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&format!(r#"tell application "{}" to activate"#, prev_app))
        .output();

    thread::sleep(Duration::from_millis(500));

    // CGEvent Cmd+V
    if try_cgevent_paste() {
        eprintln!(">>> Method 2 CGEvent SUCCEEDED!");
        return;
    }
    eprintln!(">>> Method 2 CGEvent FAILED");

    // Method 3: Try Edit > Paste menu item
    eprintln!(">>> Trying Method 3: Edit > Paste menu...");
    if try_edit_menu_paste(&prev_app) {
        eprintln!(">>> Method 3 SUCCEEDED!");
        return;
    }

    eprintln!(">>> ALL paste methods FAILED. User needs Accessibility permission.");
    error!("paste: ALL methods failed. Grant Accessibility to CoPas.");
}

#[cfg(target_os = "macos")]
fn try_cgevent_paste() -> bool {
    use core_graphics::event::{CGEvent, CGEventFlags, CGKeyCode};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use core_graphics::event::CGEventTapLocation;

    const V_KEY: CGKeyCode = 9;

    let source = match CGEventSource::new(CGEventSourceStateID::HIDSystemState) {
        Ok(s) => s,
        Err(_) => {
            eprintln!(">>> CGEventSource FAILED — no Accessibility permission");
            return false;
        }
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

#[cfg(target_os = "macos")]
fn try_edit_menu_paste(app_name: &str) -> bool {
    let script = format!(
        r#"tell application "System Events"
            tell process "{}"
                click menu item "Paste" of menu "Edit" of menu bar 1
            end tell
        end tell"#,
        app_name
    );

    match std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
    {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                eprintln!(">>> Edit > Paste FAILED: {}", stderr);
            }
            output.status.success()
        }
        Err(_) => false,
    }
}

/// Check if Accessibility permission is granted
#[cfg(target_os = "macos")]
pub fn check_accessibility() -> bool {
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    CGEventSource::new(CGEventSourceStateID::HIDSystemState).is_ok()
}

/// Windows/Linux: enigo
#[cfg(not(target_os = "macos"))]
fn simulate_paste_enigo() {
    use enigo::{Enigo, Key, Keyboard, Settings};

    let mut enigo = match Enigo::new(&Settings::default()) {
        Ok(e) => e,
        Err(e) => { error!("paste: enigo failed: {}", e); return; }
    };

    enigo.key(Key::Control, enigo::Direction::Press).ok();
    thread::sleep(Duration::from_millis(30));
    enigo.key(Key::Unicode('v'), enigo::Direction::Click).ok();
    thread::sleep(Duration::from_millis(30));
    enigo.key(Key::Control, enigo::Direction::Release).ok();
}

/// Bulk paste text
pub fn bulk_paste_text_and_simulate(contents: &[String], delimiter: &str) {
    let resolved_delim = delimiter.replace("\\n", "\n").replace("\\t", "\t");
    let combined = contents.join(&resolved_delim);
    paste_text_and_simulate(&combined);
}

/// Paste text WITH HTML formatting preserved
/// Writes both plain text and HTML to clipboard so the target app can pick the richest format
pub fn paste_rich_text_and_simulate(text: &str, html: &str) {
    eprintln!(">>> paste_rich_text_and_simulate CALLED, text_len={}, html_len={}", text.len(), html.len());
    PASTE_IN_PROGRESS.store(true, Ordering::SeqCst);

    // On macOS, use osascript to write both HTML and plain text to NSPasteboard
    #[cfg(target_os = "macos")]
    {
        // Write HTML to a temp file to avoid shell escaping issues
        let html_tmp = "/tmp/copas_paste_html.html";
        let text_tmp = "/tmp/copas_paste_text.txt";
        
        if let Err(e) = std::fs::write(html_tmp, html) {
            eprintln!(">>> paste_rich: write HTML temp failed: {}", e);
            // Fallback to plain text paste
            paste_text_and_simulate(text);
            return;
        }
        if let Err(e) = std::fs::write(text_tmp, text) {
            eprintln!(">>> paste_rich: write text temp failed: {}", e);
            paste_text_and_simulate(text);
            return;
        }

        // Use osascript to set clipboard with both HTML and plain text
        let script = r#"
            use framework "AppKit"
            
            set htmlPath to "/tmp/copas_paste_html.html"
            set textPath to "/tmp/copas_paste_text.txt"
            
            set htmlContent to read (POSIX file htmlPath) as «class utf8»
            set textContent to read (POSIX file textPath) as «class utf8»
            
            set pb to current application's NSPasteboard's generalPasteboard()
            pb's clearContents()
            pb's setString:textContent forType:(current application's NSPasteboardTypeString)
            pb's setString:htmlContent forType:(current application's NSPasteboardTypeHTML)
            
            return "OK"
        "#;

        let result = std::process::Command::new("osascript")
            .arg("-l")
            .arg("AppleScript")
            .arg("-e")
            .arg(script)
            .output();

        match result {
            Ok(output) => {
                if output.status.success() {
                    eprintln!(">>> paste_rich: clipboard set with HTML+text OK");
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    eprintln!(">>> paste_rich: NSPasteboard failed: {}, falling back to pbcopy", stderr);
                    // Fallback to plain text
                    use std::io::Write;
                    if let Ok(mut child) = std::process::Command::new("pbcopy")
                        .stdin(std::process::Stdio::piped())
                        .spawn()
                    {
                        if let Some(ref mut stdin) = child.stdin {
                            let _ = stdin.write_all(text.as_bytes());
                        }
                        let _ = child.wait();
                    }
                }
            }
            Err(e) => {
                eprintln!(">>> paste_rich: osascript error: {}", e);
            }
        }

        // Cleanup temp files
        let _ = std::fs::remove_file(html_tmp);
        let _ = std::fs::remove_file(text_tmp);
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Non-macOS: just paste plain text
        let mut clipboard = match Clipboard::new() {
            Ok(c) => c,
            Err(_) => { PASTE_IN_PROGRESS.store(false, Ordering::SeqCst); return; }
        };
        let _ = clipboard.set_text(text);
        drop(clipboard);
    }

    // Save hash
    {
        let mut hasher = Sha256::new();
        hasher.update(text.as_bytes());
        let hash = hasher.finalize().to_vec();
        if let Ok(mut lph) = LAST_PASTE_HASH.lock() {
            *lph = Some(hash);
        }
    }

    activate_and_paste();

    thread::sleep(Duration::from_millis(2000));
    PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
    eprintln!(">>> paste_rich_text_and_simulate DONE");
}

/// Bulk paste mixed content (text + images) sequentially
pub fn bulk_paste_mixed(items: &[(Option<String>, Option<String>, Option<String>)]) {
    // Each item is (text, html, image_path)
    eprintln!(">>> bulk_paste_mixed CALLED, {} items", items.len());
    
    for (i, (text, html, image_path)) in items.iter().enumerate() {
        eprintln!(">>> bulk_paste_mixed: item {}/{}", i + 1, items.len());
        
        if let Some(img_path) = image_path {
            let path = std::path::Path::new(img_path);
            paste_image_and_simulate(path);
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
        
        // Small delay between items to let target app process
        if i < items.len() - 1 {
            thread::sleep(Duration::from_millis(500));
        }
    }
    eprintln!(">>> bulk_paste_mixed DONE");
}
