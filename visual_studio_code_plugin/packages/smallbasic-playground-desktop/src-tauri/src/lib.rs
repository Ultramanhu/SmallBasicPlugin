//! Tauri v2 desktop shell of the Small Basic local playground
//! (design doc 10, §17-19).
//!
//! The main webview loads the staged Playground page and may only call the
//! narrow command surface below: whitelisted CLI backends, an ordered session
//! event channel, stdin input, a DAP request bridge and native file dialogs.
//! The Blazor graphics windows are plain remote WebviewWindows without any
//! capability, so localhost page content cannot reach this IPC surface.

mod dap;
mod process_manager;

use process_manager::{SessionManager, SpawnRequest};
use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, RunEvent, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStartInfo {
    session_id: String,
    session_dir: String,
    program_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendFlags {
    cli_csharp_net48: bool,
    cli_csharp_net8: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphicsFlags {
    cli_csharp_net48: bool,
    cli_csharp_net8: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCapabilities {
    platform: String,
    backends: BackendFlags,
    graphics: GraphicsFlags,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramFilePayload {
    name: String,
    content: String,
}

/// Availability is a filesystem fact (staged payload presence), never a UA
/// sniff. Two .NET RunHost flavours remain (doc 10, §17.2): the .NET 8
/// single-file sidecar and the Windows-only .NET Framework 4.8 folder host.
#[tauri::command]
fn desktop_capabilities(app: AppHandle) -> DesktopCapabilities {
    let windows = cfg!(windows);
    let net8 = process_manager::resolve_sidecar(&app, process_manager::NET8_SIDECAR).is_some();
    let net48 = windows
        && process_manager::resolve_staged_resource(&app, process_manager::NET48_PROGRAM).is_some();

    DesktopCapabilities {
        platform: target_triple().to_string(),
        backends: BackendFlags {
            cli_csharp_net48: net48,
            cli_csharp_net8: net8,
        },
        graphics: GraphicsFlags {
            // Native GraphicsWindow exists in both Windows hosts; the portable
            // net8.0 host used on other platforms is text-only.
            cli_csharp_net48: net48,
            cli_csharp_net8: windows && net8,
        },
    }
}

#[tauri::command]
fn run_program(
    app: AppHandle,
    state: State<'_, SessionManager>,
    backend: String,
    name: String,
    source: String,
    on_event: Channel<Value>,
) -> Result<SessionStartInfo, String> {
    let backend = parse_backend(&backend)?;
    spawn(&app, &state, backend, false, name, source, on_event)
}

#[tauri::command]
fn start_debug(
    app: AppHandle,
    state: State<'_, SessionManager>,
    backend: String,
    name: String,
    source: String,
    on_event: Channel<Value>,
) -> Result<SessionStartInfo, String> {
    let backend = parse_backend(&backend)?;
    spawn(&app, &state, backend, true, name, source, on_event)
}

fn parse_backend(value: &str) -> Result<process_manager::Backend, String> {
    process_manager::Backend::parse(value)
        .ok_or_else(|| format!("backend '{value}' is not on the desktop whitelist"))
}

fn spawn(
    app: &AppHandle,
    state: &State<'_, SessionManager>,
    backend: process_manager::Backend,
    debug: bool,
    name: String,
    source: String,
    on_event: Channel<Value>,
) -> Result<SessionStartInfo, String> {
    let outcome = process_manager::spawn_session(
        app,
        state.inner(),
        SpawnRequest {
            backend,
            debug,
            name,
            source,
            on_event,
        },
    )?;

    Ok(SessionStartInfo {
        session_id: outcome.session.id.clone(),
        session_dir: outcome.session_dir.to_string_lossy().into_owned(),
        program_path: outcome.program_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn send_input(state: State<'_, SessionManager>, session_id: String, text: String) -> Result<(), String> {
    let session = state
        .inner()
        .get(&session_id)
        .ok_or_else(|| "unknown session id".to_string())?;
    session.send_stdin(&text)
}

/// Forwards one mapped DAP request through the Rust framer, which owns the
/// framing and the sequence numbers (doc 10, §18.3).
#[tauri::command]
fn debug_request(
    state: State<'_, SessionManager>,
    session_id: String,
    command: String,
    args: Value,
) -> Result<u64, String> {
    let session = state
        .inner()
        .get(&session_id)
        .ok_or_else(|| "unknown session id".to_string())?;
    let framer = session
        .dap()
        .ok_or_else(|| "this session is not a debug session".to_string())?;
    framer
        .send(&command, &args)
        .map_err(|error| format!("failed to write the DAP request: {error}"))
}

#[tauri::command]
fn terminate_session(state: State<'_, SessionManager>, session_id: String) -> Result<(), String> {
    process_manager::terminate_session(state.inner(), &session_id)
}

/// Native Open dialog; the page keeps using its file input in browsers.
#[cfg(desktop)]
#[tauri::command]
fn pick_program_file() -> Result<Option<ProgramFilePayload>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Small Basic", &["sb", "txt"])
        .set_title("Open a Small Basic program")
        .pick_file()
    else {
        return Ok(None);
    };

    let content = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let content = content.strip_prefix('\u{feff}').unwrap_or(&content).to_string();
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "program.sb".to_string());
    Ok(Some(ProgramFilePayload { name, content }))
}

/// Mobile shells have no native dialog backend; the page falls back to the
/// web file input and the two Web execution backends.
#[cfg(mobile)]
#[tauri::command]
fn pick_program_file() -> Result<Option<ProgramFilePayload>, String> {
    Err("native file dialogs are only available on desktop platforms".to_string())
}

/// Native Save dialog; returns the chosen file name for the status bar.
#[cfg(desktop)]
#[tauri::command]
fn save_program_file(default_name: String, source: String) -> Result<Option<ProgramFilePayload>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Small Basic", &["sb", "txt"])
        .set_title("Save the Small Basic program")
        .set_file_name(&default_name)
        .save_file()
    else {
        return Ok(None);
    };

    std::fs::write(&path, source.as_bytes()).map_err(|error| error.to_string())?;
    Ok(Some(ProgramFilePayload {
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| default_name),
        content: String::new(),
    }))
}

#[cfg(mobile)]
#[tauri::command]
fn save_program_file(_default_name: String, _source: String) -> Result<Option<ProgramFilePayload>, String> {
    Err("native file dialogs are only available on desktop platforms".to_string())
}

/// Mobile builds load this library through the Android activity, so the
/// entry point must be annotated; desktop builds use `main.rs` instead.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SessionManager::default())
        .invoke_handler(tauri::generate_handler![
            desktop_capabilities,
            run_program,
            start_debug,
            send_input,
            debug_request,
            terminate_session,
            pick_program_file,
            save_program_file
        ])
        .build(tauri::generate_context!())
        .expect("failed to build the Small Basic Playground application")
        .run(|app_handle, event| {
            // App quit, last window closed, crash path - all end here, so the
            // child tree cleanup lives in exactly one place (doc 10, §19.2).
            if let RunEvent::Exit = event {
                app_handle.state::<SessionManager>().terminate_all_now();
            }
        });
}

pub fn target_triple() -> &'static str {
    env!("SB_TARGET_TRIPLE")
}
