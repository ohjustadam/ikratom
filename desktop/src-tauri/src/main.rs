// iKratom desktop shell — window chrome around the live app. All product
// logic lives server-side; this binary is intentionally dumb so it never
// needs an update when the site changes.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running iKratom");
}
