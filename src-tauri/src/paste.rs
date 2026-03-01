use arboard::Clipboard;
use log::{error, info};
use std::path::Path;
use std::thread;
use std::time::Duration;

/// Write text to clipboard and simulate paste (Cmd+V on macOS, Ctrl+V on Windows)
pub fn paste_text_and_simulate(text: &str) {
    let mut clipboard = match Clipboard::new() {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to open clipboard for paste: {}", e);
            return;
        }
    };

    if let Err(e) = clipboard.set_text(text) {
        error!("Failed to set clipboard text: {}", e);
        return;
    }

    drop(clipboard);

    // Wait for the target app to regain focus after CoPas hides
    thread::sleep(Duration::from_millis(500));

    simulate_paste_keystroke();
}

/// Write image to clipboard and simulate paste
pub fn paste_image_and_simulate(image_path: &Path) {
    let img = match image::open(image_path) {
        Ok(img) => img,
        Err(e) => {
            error!("Failed to open image file {:?}: {}", image_path, e);
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
        return;
    }

    drop(clipboard);
    thread::sleep(Duration::from_millis(500));
    simulate_paste_keystroke();
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
/// This works from any thread and only requires Accessibility permission.
/// Unlike osascript which is blocked by macOS security (error 1002),
/// CGEvent is the proper low-level API for keyboard simulation.
#[cfg(target_os = "macos")]
fn simulate_paste_cgevent() {
    use core_graphics::event::{CGEvent, CGEventFlags, CGKeyCode};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use core_graphics::event::CGEventTapLocation;

    info!("Simulating Cmd+V via CGEvent...");

    // Key code 9 = 'V' key on macOS keyboard
    const V_KEY: CGKeyCode = 9;

    let source = match CGEventSource::new(CGEventSourceStateID::HIDSystemState) {
        Ok(s) => s,
        Err(_) => {
            error!("Failed to create CGEventSource — check Accessibility permission");
            return;
        }
    };

    // Key down: V with Command flag
    let key_down = match CGEvent::new_keyboard_event(source.clone(), V_KEY, true) {
        Ok(e) => e,
        Err(_) => {
            error!("Failed to create CGEvent key down");
            return;
        }
    };
    key_down.set_flags(CGEventFlags::CGEventFlagCommand);

    // Key up: V with Command flag
    let key_up = match CGEvent::new_keyboard_event(source, V_KEY, false) {
        Ok(e) => e,
        Err(_) => {
            error!("Failed to create CGEvent key up");
            return;
        }
    };
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);

    // Post events to the HID system
    key_down.post(CGEventTapLocation::HID);
    thread::sleep(Duration::from_millis(30));
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
