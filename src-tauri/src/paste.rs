use arboard::Clipboard;
use log::{error, info, warn};
use std::path::Path;
use std::thread;
use std::time::Duration;

/// Write text to clipboard and simulate paste (Cmd+V on macOS, Ctrl+V on Windows)
pub fn paste_text_and_simulate(text: &str) {
    // Write to clipboard
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

    // Drop clipboard before simulating paste
    drop(clipboard);

    // Wait for the target app to regain focus after CoPas hides
    thread::sleep(Duration::from_millis(350));

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
    thread::sleep(Duration::from_millis(350));
    simulate_paste_keystroke();
}

/// Simulate Ctrl+V (Windows) or Cmd+V (macOS)
fn simulate_paste_keystroke() {
    #[cfg(target_os = "macos")]
    {
        // Strategy 1: osascript (requires Accessibility permission)
        info!("Attempting paste via osascript...");
        let result = std::process::Command::new("osascript")
            .arg("-e")
            .arg("delay 0.4")
            .arg("-e")
            .arg("tell application \"System Events\" to keystroke \"v\" using command down")
            .output();

        match result {
            Ok(output) => {
                if output.status.success() {
                    info!("osascript paste succeeded");
                    return;
                }
                let stderr = String::from_utf8_lossy(&output.stderr);
                warn!("osascript paste failed ({}), trying enigo...", stderr.trim());
            }
            Err(e) => {
                warn!("osascript spawn failed: {}, trying enigo...", e);
            }
        }

        // Strategy 2: enigo (also requires Accessibility)
        simulate_paste_enigo();
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

/// Fallback paste simulation using enigo
fn simulate_paste_enigo() {
    use enigo::{Enigo, Key, Keyboard, Settings};

    info!("Attempting paste via enigo...");

    let mut enigo = match Enigo::new(&Settings::default()) {
        Ok(e) => e,
        Err(e) => {
            error!("Failed to create enigo instance: {}", e);
            return;
        }
    };

    #[cfg(target_os = "macos")]
    {
        // Small delay for focus
        thread::sleep(Duration::from_millis(100));
        enigo.key(Key::Meta, enigo::Direction::Press).ok();
        thread::sleep(Duration::from_millis(30));
        enigo.key(Key::Unicode('v'), enigo::Direction::Click).ok();
        thread::sleep(Duration::from_millis(30));
        enigo.key(Key::Meta, enigo::Direction::Release).ok();
    }

    #[cfg(target_os = "windows")]
    {
        enigo.key(Key::Control, enigo::Direction::Press).ok();
        thread::sleep(Duration::from_millis(30));
        enigo.key(Key::Unicode('v'), enigo::Direction::Click).ok();
        thread::sleep(Duration::from_millis(30));
        enigo.key(Key::Control, enigo::Direction::Release).ok();
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        enigo.key(Key::Control, enigo::Direction::Press).ok();
        thread::sleep(Duration::from_millis(30));
        enigo.key(Key::Unicode('v'), enigo::Direction::Click).ok();
        thread::sleep(Duration::from_millis(30));
        enigo.key(Key::Control, enigo::Direction::Release).ok();
    }
}

/// Write multiple texts joined by delimiter to clipboard and simulate paste
pub fn bulk_paste_text_and_simulate(contents: &[String], delimiter: &str) {
    let resolved_delim = delimiter.replace("\\n", "\n").replace("\\t", "\t");
    let combined = contents.join(&resolved_delim);
    paste_text_and_simulate(&combined);
}
