use sha2::{Sha256, Digest};
use log::info;

/// Secret used to generate license keys (HMAC signing)
/// In production, keys are generated server-side. This secret is used
/// client-side ONLY for validation.
const LICENSE_SECRET: &str = "CoPas-Premium-2026-SecretKey-DoNotShare";

/// Get unique machine identifier
pub fn get_machine_id() -> String {
    let raw = get_raw_machine_id();
    // Hash it for consistent length and privacy
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    let hash = hasher.finalize();
    hex::encode(&hash[..16]) // 32 char hex string
}

#[cfg(target_os = "macos")]
fn get_raw_machine_id() -> String {
    // Use IOPlatformUUID on macOS
    if let Ok(output) = std::process::Command::new("ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
    {
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            if line.contains("IOPlatformUUID") {
                if let Some(uuid) = line.split('"').nth(3) {
                    return uuid.to_string();
                }
            }
        }
    }
    // Fallback: hostname + username
    fallback_machine_id()
}

#[cfg(target_os = "windows")]
fn get_raw_machine_id() -> String {
    // Use Windows MachineGUID from registry
    if let Ok(output) = std::process::Command::new("reg")
        .args(["query", r"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography", "/v", "MachineGuid"])
        .output()
    {
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            if line.contains("MachineGuid") {
                if let Some(guid) = line.split_whitespace().last() {
                    return guid.to_string();
                }
            }
        }
    }
    fallback_machine_id()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn get_raw_machine_id() -> String {
    // Linux: /etc/machine-id
    if let Ok(id) = std::fs::read_to_string("/etc/machine-id") {
        return id.trim().to_string();
    }
    fallback_machine_id()
}

fn fallback_machine_id() -> String {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    let username = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "user".to_string());
    format!("{}-{}", hostname, username)
}

/// Validate a license key against this machine's ID
pub fn validate_license_key(key: &str) -> bool {
    let machine_id = get_machine_id();
    let expected = generate_license_key_for_machine(&machine_id);
    let clean_key = key.trim().to_uppercase().replace(' ', "");
    let clean_expected = expected.replace(' ', "");
    info!("License validation: machine_id={}", machine_id);
    clean_key == clean_expected
}

/// Generate a license key for a specific machine ID
/// This function is used server-side (or by admin) to generate keys
pub fn generate_license_key_for_machine(machine_id: &str) -> String {
    use sha2::Sha256;
    use hmac::{Hmac, Mac};
    type HmacSha256 = Hmac<Sha256>;

    let mut mac = HmacSha256::new_from_slice(LICENSE_SECRET.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(machine_id.as_bytes());
    let result = mac.finalize().into_bytes();

    // Take first 16 bytes, encode as uppercase hex, format as COPAS-XXXXX-XXXXX-XXXXX-XXXXX
    let hex = hex::encode(&result[..16]).to_uppercase();
    format!(
        "COPAS-{}-{}-{}-{}",
        &hex[0..5],
        &hex[5..10],
        &hex[10..15],
        &hex[15..20],
    )
}
