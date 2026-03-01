use arboard::Clipboard;
use log::{error, info};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

/// Global flag: when true, clipboard watcher should skip the next change
/// (because we're the ones writing to clipboard for paste, not the user copying)
pub static PASTE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

/// Write text to clipboard and simulate paste (Cmd+V on macOS, Ctrl+V on Windows)
pub fn paste_text_and_simulate(text: &str) {
    // Signal clipboard watcher to ignore the next clipboard change
    PASTE_IN_PROGRESS.store(true, Ordering::SeqCst);

    let mut clipboard = match Clipboard::new() {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to open clipboard for paste: {}", e);
            PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
            return;
        }
    };

    if let Err(e) = clipboard.set_text(text) {
        error!("Failed to set clipboard text: {}", e);
        PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
        return;
    }

    drop(clipboard);

    // Wait for the target app to regain focus after CoPas hides
    thread::sleep(Duration::from_millis(500));

    simulate_paste_keystroke();

    // Keep the flag active for a bit so the watcher's next poll cycle skips
    thread::sleep(Duration::from_millis(800));
    PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
}

/// Write image to clipboard and simulate paste
pub fn paste_image_and_simulate(image_path: &Path) {
    PASTE_IN_PROGRESS.store(true, Ordering::SeqCst);

    let img = match image::open(image_path) {
        Ok(img) => img,
        Err(e) => {
            error!("Failed to open image file {:?}: {}", image_path, e);
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
            error!("Failed to open clipboard for image paste: {}", e);
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
        error!("Failed to set clipboard image: {}", e);
        PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
        return;
    }

    drop(clipboard);
    thread::sleep(Duration::from_millis(500));
    simulate_paste_keystroke();

    thread::sleep(Duration::from_millis(800));
    PASTE_IN_PROGRESS.store(false, Ordering::SeqCst);
}

/// Simulate Ctrl+V (Windows) or Cmd+V (macOS)
fn simulate_paste_keystroke() {
    #[cfg(target_os = "macos")]
    {
        simulate_paste_cgevent();
    }

    #[cfg(target_os = "windows")]
    {
        simulate_paste_enigo();
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        simulate_paste_enigo();
    }
}

/// macOS: Use CoreGraphics CGEvent to simulate Cmd+V
/// First activate the previous app (since CoPas just hid), then post CGEvent.
/// osascript CAN activate apps (just can't send keystrokes — error 1002).
#[cfg(target_os = "macos")]
fn simulate_paste_cgevent() {
    use core_graphics::event::{CGEvent, CGEventFlags, CGKeyCode};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use core_graphics::event::CGEventTapLocation;

    // Step 1: Activate the frontmost non-CoPas app
    // osascript CAN activate apps, just can't send keystrokes
    info!("Activating previous app...");
    let _ = std::process::Command::new("osascript")
        .arg("-e")
        .arg(r#"
            tell application "System Events"
                set appList to every process whose frontmost is true
                if (count of appList) > 0 then
                    set frontApp to name of item 1 of appList
                    if frontApp is not "CoPas" and frontApp is not "copas" then
                        tell process frontApp to set frontmost to true
                    end if
                end if
            end tell
        "#)
        .output();

    // Wait for the app to fully activate
    thread::sleep(Duration::from_millis(300));

    // Step 2: Post CGEvent Cmd+V
    info!("Simulating Cmd+V via CGEvent...");

    const V_KEY: CGKeyCode = 9;

    let source = match CGEventSource::new(CGEventSourceStateID::HIDSystemState) {
        Ok(s) => s,
        Err(_) => {
            error!("Failed to create CGEventSource — Accessibility permission required! \
                    Go to System Settings → Privacy & Security → Accessibility → enable CoPas");
            return;
        }
    };

    let key_down = match CGEvent::new_keyboard_event(source.clone(), V_KEY, true) {
        Ok(e) => e,
        Err(_) => {
            error!("Failed to create CGEvent key down");
            return;
        }
    };
    key_down.set_flags(CGEventFlags::CGEventFlagCommand);

    let key_up = match CGEvent::new_keyboard_event(source, V_KEY, false) {
        Ok(e) => e,
        Err(_) => {
            error!("Failed to create CGEvent key up");
            return;
        }
    };
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);

    key_down.post(CGEventTapLocation::HID);
    thread::sleep(Duration::from_millis(50));
    key_up.post(CGEventTapLocation::HID);

    info!("CGEvent Cmd+V posted successfully");
}

/// Windows/Linux: Paste simulation using enigo
#[cfg(not(target_os = "macos"))]
fn simulate_paste_enigo() {
    use enigo::{Enigo, Key, Keyboard, Settings};

    info!("Simulating paste via enigo...");

    let mut enigo = match Enigo::new(&Settings::default()) {
        Ok(e) => e,
        Err(e) => {
            error!("Failed to create enigo instance: {}", e);
            return;
        }
    };

    enigo.key(Key::Control, enigo::Direction::Press).ok();
    thread::sleep(Duration::from_millis(30));
    enigo.key(Key::Unicode('v'), enigo::Direction::Click).ok();
    thread::sleep(Duration::from_millis(30));
    enigo.key(Key::Control, enigo::Direction::Release).ok();
}

/// Write multiple texts joined by delimiter to clipboard and simulate paste
pub fn bulk_paste_text_and_simulate(contents: &[String], delimiter: &str) {
    let resolved_delim = delimiter.replace("\\n", "\n").replace("\\t", "\t");
    let combined = contents.join(&resolved_delim);
    paste_text_and_simulate(&combined);
}
