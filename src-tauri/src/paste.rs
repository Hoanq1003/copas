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
    thread::sleep(Duration::from_millis(400));

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
    thread::sleep(Duration::from_millis(400));
    simulate_paste_keystroke();
}

/// Simulate Ctrl+V (Windows) or Cmd+V (macOS)
fn simulate_paste_keystroke() {
    #[cfg(target_os = "macos")]
    {
        // macOS: ONLY use osascript — enigo crashes from background threads
        // because macOS TSM (Text Services Manager) APIs require main thread
        info!("Simulating Cmd+V via osascript...");
        let result = std::process::Command::new("osascript")
            .arg("-e")
            .arg("delay 0.35")
            .arg("-e")
            .arg("tell application \"System Events\" to keystroke \"v\" using command down")
            .output();

        match result {
            Ok(output) => {
                if output.status.success() {
                    info!("osascript paste succeeded");
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    warn!("osascript paste failed: {}", stderr.trim());
                }
            }
            Err(e) => {
                error!("osascript command failed to run: {}", e);
            }
        }
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

/// Paste simulation using enigo (Windows/Linux only — crashes on macOS from bg thread)
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
