use arboard::Clipboard;
use log::{error, info};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

/// Global flag: when true, clipboard watcher should skip the next change
pub static PASTE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

/// Write text to clipboard and simulate paste
pub fn paste_text_and_simulate(text: &str) {
    PASTE_IN_PROGRESS.store(true, Ordering::SeqCst);

    let mut clipboard = match Clipboard::new() {
        Ok(c) => c,
        Err(e) => {
            error!("paste: clipboard open failed: {}", e);
            PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
            return;
        }
    };

    if let Err(e) = clipboard.set_text(text) {
        error!("paste: clipboard set_text failed: {}", e);
        PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
        return;
    }
    drop(clipboard);

    // Activate previous app and simulate Cmd+V
    activate_and_paste();

    // Keep flag active for watcher to skip
    thread::sleep(Duration::from_millis(600));
    PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
}

/// Write image to clipboard and simulate paste
pub fn paste_image_and_simulate(image_path: &Path) {
    PASTE_IN_PROGRESS.store(true, Ordering::SeqCst);

    let img = match image::open(image_path) {
        Ok(img) => img,
        Err(e) => {
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

    activate_and_paste();

    thread::sleep(Duration::from_millis(600));
    PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
}

/// Activate the previous app and simulate paste keystroke
fn activate_and_paste() {
    #[cfg(target_os = "macos")]
    {
        // Step 1: Get the saved previous app name
        let prev_app = {
            crate::PREVIOUS_APP_NAME.lock()
                .map(|n| n.clone())
                .unwrap_or_default()
        };

        // Step 2: Activate that app by name
        if !prev_app.is_empty() {
            info!("paste: activating '{}' ...", prev_app);
            let script = format!(
                r#"tell application "{}" to activate"#,
                prev_app
            );
            let _ = std::process::Command::new("osascript")
                .arg("-e")
                .arg(&script)
                .output();
        } else {
            info!("paste: no previous app saved, using generic activation");
            // Fallback: Cmd+Tab to switch to previous app
            let _ = std::process::Command::new("osascript")
                .arg("-e")
                .arg(r#"tell application "System Events" to set frontmost of (first process whose frontmost is false and visible is true) to true"#)
                .output();
        }

        // Wait for activation to complete
        thread::sleep(Duration::from_millis(400));

        // Step 3: Simulate Cmd+V via CGEvent
        simulate_paste_cgevent();
    }

    #[cfg(not(target_os = "macos"))]
    {
        thread::sleep(Duration::from_millis(300));
        simulate_paste_enigo();
    }
}

/// macOS: CGEvent Cmd+V
#[cfg(target_os = "macos")]
fn simulate_paste_cgevent() {
    use core_graphics::event::{CGEvent, CGEventFlags, CGKeyCode};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use core_graphics::event::CGEventTapLocation;

    info!("paste: posting CGEvent Cmd+V ...");

    const V_KEY: CGKeyCode = 9;

    let source = match CGEventSource::new(CGEventSourceStateID::HIDSystemState) {
        Ok(s) => s,
        Err(_) => {
            error!("paste: CGEventSource failed — Accessibility permission needed");
            return;
        }
    };

    let key_down = match CGEvent::new_keyboard_event(source.clone(), V_KEY, true) {
        Ok(e) => e,
        Err(_) => { error!("paste: CGEvent key_down failed"); return; }
    };
    key_down.set_flags(CGEventFlags::CGEventFlagCommand);

    let key_up = match CGEvent::new_keyboard_event(source, V_KEY, false) {
        Ok(e) => e,
        Err(_) => { error!("paste: CGEvent key_up failed"); return; }
    };
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);

    key_down.post(CGEventTapLocation::HID);
    thread::sleep(Duration::from_millis(50));
    key_up.post(CGEventTapLocation::HID);

    info!("paste: CGEvent Cmd+V posted OK");
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

/// Bulk paste
pub fn bulk_paste_text_and_simulate(contents: &[String], delimiter: &str) {
    let resolved_delim = delimiter.replace("\\n", "\n").replace("\\t", "\t");
    let combined = contents.join(&resolved_delim);
    paste_text_and_simulate(&combined);
}
