#[tauri::command]
fn health_check() -> &'static str {
    "ok"
}

const SECRET_SERVICE: &str = "com.clarity.expressioncoach";

fn secret_entry(kind: &str) -> Result<keyring::Entry, String> {
    if !matches!(kind, "ai" | "online-asr" | "sync") {
        return Err("不支持的凭证类型".to_string());
    }
    keyring::Entry::new(SECRET_SERVICE, kind).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_device_secret(kind: String) -> Result<Option<String>, String> {
    match secret_entry(&kind)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn set_device_secret(kind: String, value: String) -> Result<(), String> {
    let entry = secret_entry(&kind)?;
    if value.trim().is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    } else {
        entry
            .set_password(value.trim())
            .map_err(|error| error.to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(native_asr::NativeAsrState::default())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            health_check,
            get_device_secret,
            set_device_secret,
            native_asr::native_asr_capabilities,
            native_asr::native_asr_model_status,
            native_asr::native_asr_install_model,
            native_asr::native_asr_delete_model,
            native_asr::native_asr_stage_audio,
            native_asr::native_asr_transcribe,
            native_asr::native_asr_cancel
        ])
        .run(tauri::generate_context!())
        .expect("failed to run application");
}
mod native_asr;
