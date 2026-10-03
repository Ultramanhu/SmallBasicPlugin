//! Session and child-process management for the CLI sidecar backend
//! (doc 10, §17.3 / §18).
//!
//! Every session owns exactly one managed child process whose argv is derived
//! from the backend enum - the page can only pass source text, a display name
//! and a backend id. Output streams through an ordered Tauri channel, stdin
//! accepts TextWindow lines, debug sessions speak DAP over stdout, and the
//! session directory under the app cache holds the scratch `program.sb` that
//! is removed when the process exits.
//!
//! Only the .NET RunHost remains, in two flavours: the self-contained .NET 8
//! single-file sidecar and the .NET Framework 4.8 folder host. The Node and
//! Blazor CLI backends were removed on 2026-10-03 (doc 10, §17.2); the Blazor
//! graphics webview went with them, so cross-platform graphics belong to the
//! Web Blazor backend.

use crate::dap::{DapFramer, DapParser, Utf8Accumulator};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

pub const BACKEND_CSHARP_NET48: &str = "cli-csharp-net48";
pub const BACKEND_CSHARP_NET8: &str = "cli-csharp-net8";

/// Staged single-file sidecar base name. `tauri.conf.json`'s `bundle.externalBin`
/// and `stage-playground.mjs` must agree on it (doc 10, §18.5).
pub const NET8_SIDECAR: &str = "smallbasic-csharp-net8";

/// The .NET Framework 4.8 host cannot be published as a single file, so it
/// ships as a folder payload carried by `bundle.resources` and is located
/// through the staged resources instead of `externalBin` (doc 10, §18.5).
pub const NET48_PROGRAM: &str = "resources/dotnet/csharp-net48/SmallBasic.RunHost.exe";

/// Grace period between the protocol-level disconnect and the tree kill.
const DISCONNECT_GRACE: Duration = Duration::from_millis(2000);
const POLL_INTERVAL: Duration = Duration::from_millis(50);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Backend {
    CSharpNet48,
    CSharpNet8,
}

impl Backend {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            BACKEND_CSHARP_NET48 => Some(Self::CSharpNet48),
            BACKEND_CSHARP_NET8 => Some(Self::CSharpNet8),
            _ => None,
        }
    }

    /// Human-readable name used in the process-start error message.
    fn display_name(self) -> &'static str {
        match self {
            Self::CSharpNet48 => "the .NET Framework 4.8 C# host",
            Self::CSharpNet8 => "the .NET 8 C# sidecar",
        }
    }
}

pub struct Session {
    pub id: String,
    pub debug: bool,
    pub pid: u32,
    pub kill: AtomicBool,
    stdin: Mutex<Option<ChildStdin>>,
    dap: Option<Arc<DapFramer>>,
    session_dir: PathBuf,
}

impl Session {
    pub fn send_stdin(&self, text: &str) -> Result<(), String> {
        let mut guard = self.stdin.lock().expect("stdin lock poisoned");
        let stdin = guard
            .as_mut()
            .ok_or_else(|| "this session does not accept stdin input".to_string())?;
        let line = if text.ends_with('\n') {
            text.to_string()
        } else {
            format!("{text}\n")
        };
        stdin
            .write_all(line.as_bytes())
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("failed to write to the session stdin: {error}"))
    }

    pub fn dap(&self) -> Option<Arc<DapFramer>> {
        self.dap.clone()
    }
}

#[derive(Default)]
struct ManagerInner {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}

/// Shared registry of live sessions. Clones share the same underlying maps.
#[derive(Clone, Default)]
pub struct SessionManager {
    inner: Arc<ManagerInner>,
}

impl SessionManager {
    fn insert(&self, session: Arc<Session>) {
        self.inner
            .sessions
            .lock()
            .expect("sessions lock poisoned")
            .insert(session.id.clone(), session);
    }

    pub fn get(&self, session_id: &str) -> Option<Arc<Session>> {
        self.inner
            .sessions
            .lock()
            .expect("sessions lock poisoned")
            .get(session_id)
            .cloned()
    }

    fn remove(&self, session_id: &str) {
        self.inner
            .sessions
            .lock()
            .expect("sessions lock poisoned")
            .remove(session_id);
    }

    /// Synchronous teardown for app exit: no protocol goodbyes, just the tree.
    pub fn terminate_all_now(&self) {
        let sessions: Vec<Arc<Session>> = self
            .inner
            .sessions
            .lock()
            .expect("sessions lock poisoned")
            .values()
            .cloned()
            .collect();
        for session in sessions {
            session.kill.store(true, Ordering::SeqCst);
            let _ = kill_tree(session.pid);
        }
    }
}

pub struct SpawnRequest {
    pub backend: Backend,
    pub debug: bool,
    pub name: String,
    pub source: String,
    pub on_event: Channel<Value>,
}

pub struct SpawnOutcome {
    pub session: Arc<Session>,
    pub session_dir: PathBuf,
    pub program_path: PathBuf,
}

pub fn spawn_session(
    app: &AppHandle,
    manager: &SessionManager,
    request: SpawnRequest,
) -> Result<SpawnOutcome, String> {
    let session_id = uuid::Uuid::new_v4().simple().to_string();
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("failed to resolve the app cache directory: {error}"))?;
    let session_dir = cache_dir.join("sessions").join(&session_id);
    std::fs::create_dir_all(&session_dir)
        .map_err(|error| format!("failed to create the session directory: {error}"))?;

    let result = spawn_in_dir(app, manager, request, &session_id, &session_dir);
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&session_dir);
    }
    result
}

fn spawn_in_dir(
    app: &AppHandle,
    manager: &SessionManager,
    request: SpawnRequest,
    session_id: &str,
    session_dir: &Path,
) -> Result<SpawnOutcome, String> {
    let program_path = session_dir.join("program.sb");
    let mut source = request.source;
    if !source.ends_with('\n') {
        source.push('\n');
    }
    std::fs::write(&program_path, source.as_bytes())
        .map_err(|error| format!("failed to write the session program: {error}"))?;

    let mut command =
        build_command(app, request.backend, request.debug, &program_path, session_dir)?;
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let mut child = command.spawn().map_err(|error| {
        format!(
            "failed to start {}: {error}",
            request.backend.display_name()
        )
    })?;
    let pid = child.id();
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let (dap, stdin_slot) = if request.debug {
        let owned_stdin = stdin.ok_or("the sidecar did not provide stdin")?;
        let framer = Arc::new(DapFramer::new(Box::new(owned_stdin)));
        // The adapter drives the run through DAP; TextWindow input arrives as
        // `evaluate` requests, so the raw stdin stays inside the framer.
        (Some(framer), None)
    } else {
        (None, stdin)
    };

    let session = Arc::new(Session {
        id: session_id.to_string(),
        debug: request.debug,
        pid,
        kill: AtomicBool::new(false),
        stdin: Mutex::new(stdin_slot),
        dap: dap.clone(),
        session_dir: session_dir.to_path_buf(),
    });
    manager.insert(session.clone());

    let channel = request.on_event;
    emit(&channel, json!({"kind": "status", "status": "started", "name": request.name}));
    if request.debug {
        let framer = dap.expect("debug sessions own a DAP framer");
        framer
            .send(
                "initialize",
                &json!({
                    "adapterID": "smallbasic-playground",
                    "clientID": "smallbasic.desktop",
                    "clientName": "Small Basic Playground",
                    "locale": "en-US",
                    "linesStartAt1": true,
                    "columnsStartAt1": true,
                    "pathFormat": "path",
                    "supportsVariableType": false,
                    "supportsConditionalBreakpoints": true,
                    "supportsRunInTerminalRequest": false
                }),
            )
            .map_err(|error| format!("failed to initialize the debug adapter: {error}"))?;
    }

    spawn_stdout_reader(stdout, channel.clone(), request.debug);
    spawn_stderr_reader(stderr, channel.clone());
    spawn_waiter(child, channel, manager.clone(), session.clone());

    Ok(SpawnOutcome {
        session,
        session_dir: session_dir.to_path_buf(),
        program_path,
    })
}

fn spawn_stdout_reader(stdout: Option<std::process::ChildStdout>, channel: Channel<Value>, debug: bool) {
    let Some(mut stdout) = stdout else {
        return;
    };

    thread::spawn(move || {
        let mut parser = DapParser::new();
        let mut decoder = Utf8Accumulator::default();
        let mut buffer = [0u8; 8192];
        loop {
            match stdout.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if debug {
                        for message in parser.push(&buffer[..read]) {
                            emit(&channel, json!({"kind": "dap", "message": message}));
                        }
                    } else {
                        let text = decoder.push(&buffer[..read]);
                        if !text.is_empty() {
                            emit(&channel, json!({"kind": "stdout", "text": text}));
                        }
                    }
                }
            }
        }
    });
}

fn spawn_stderr_reader(stderr: Option<std::process::ChildStderr>, channel: Channel<Value>) {
    let Some(mut stderr) = stderr else {
        return;
    };

    thread::spawn(move || {
        let mut decoder = Utf8Accumulator::default();
        let mut buffer = [0u8; 8192];
        loop {
            match stderr.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    let text = decoder.push(&buffer[..read]);
                    if !text.is_empty() {
                        emit(&channel, json!({"kind": "stderr", "text": text}));
                    }
                }
            }
        }
    });
}

fn spawn_waiter(
    mut child: Child,
    channel: Channel<Value>,
    manager: SessionManager,
    session: Arc<Session>,
) {
    thread::spawn(move || {
        let exit_code = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status.code(),
                Ok(None) => {
                    if session.kill.load(Ordering::SeqCst) {
                        let _ = kill_tree(child.id());
                        let _ = child.wait();
                        break None;
                    }
                    thread::sleep(POLL_INTERVAL);
                }
                Err(_) => {
                    let _ = child.wait();
                    break None;
                }
            }
        };

        emit(&channel, json!({"kind": "exited", "exitCode": exit_code}));
        // Session teardown: scratch directory and registry entry.
        let _ = std::fs::remove_dir_all(&session.session_dir);
        manager.remove(&session.id);
    });
}

pub fn terminate_session(manager: &SessionManager, session_id: &str) -> Result<(), String> {
    let Some(session) = manager.get(session_id) else {
        // Already gone; termination is idempotent.
        return Ok(());
    };

    if session.debug {
        if let Some(framer) = session.dap() {
            // Protocol goodbye first; the watchdog below enforces the timeout
            // and the waiter thread performs the actual tree kill (doc 10, §18.2).
            let _ = framer.send("disconnect", &json!({}));
        }
        let session = session.clone();
        thread::spawn(move || {
            thread::sleep(DISCONNECT_GRACE);
            session.kill.store(true, Ordering::SeqCst);
        });
    } else {
        session.kill.store(true, Ordering::SeqCst);
    }

    Ok(())
}

/// Resolves the sidecar executable for the current target. At bundle time
/// Tauri strips the target triple from `externalBin` names, so the installed
/// layout carries `smallbasic-<backend>.exe` next to the main executable,
/// while the staging tree and dev runs use `smallbasic-<backend>-<triple>`.
pub fn resolve_sidecar(app: &AppHandle, base_name: &str) -> Option<PathBuf> {
    let triple = crate::target_triple();
    let names: Vec<String> = if cfg!(windows) {
        vec![format!("{base_name}-{triple}.exe"), format!("{base_name}.exe")]
    } else {
        vec![format!("{base_name}-{triple}"), base_name.to_string()]
    };

    let mut candidates: Vec<PathBuf> = Vec::new();
    for name in &names {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                candidates.push(dir.join(name));
            }
        }
        if let Ok(resource_dir) = app.path().resource_dir() {
            candidates.push(resource_dir.join(name));
            candidates.push(resource_dir.join("bin").join(name));
        }
        if let Ok(stage) = std::env::var("SB_PLAYGROUND_STAGE") {
            candidates.push(PathBuf::from(&stage).join("bin").join(name));
        }
    }

    candidates.into_iter().find(|path| path.is_file())
}

/// Resolves a resource relative to the staging root `runhost/playground/`, used
/// for the .NET Framework 4.8 folder host. Tauri encodes the `..` segments of
/// `bundle.resources` paths as literal `_up_` directories inside the install
/// dir (`tauri-utils resources.rs`), so the depth is probed instead of assumed;
/// the portable layout (resource dir == the executable's directory) and the
/// `SB_PLAYGROUND_STAGE` dev path are covered as well.
pub fn resolve_staged_resource(app: &AppHandle, relative: &str) -> Option<PathBuf> {
    let relative = Path::new(relative);
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(stage) = std::env::var("SB_PLAYGROUND_STAGE") {
        candidates.push(PathBuf::from(&stage).join(relative));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(relative));
        // Depth 0 = resources flattened under the resource dir; each further
        // depth matches one `_up_` level of the installed layout.
        for depth in 0..=6usize {
            let mut candidate = resource_dir.clone();
            for _ in 0..depth {
                candidate.push("_up_");
            }
            candidate.push("runhost");
            candidate.push("playground");
            candidate.push(relative);
            candidates.push(candidate);
        }
    }

    candidates.into_iter().find(|path| path.is_file())
}

fn build_command(
    app: &AppHandle,
    backend: Backend,
    debug: bool,
    program_path: &Path,
    session_dir: &Path,
) -> Result<Command, String> {
    let (mut command, working_directory) = match backend {
        Backend::CSharpNet8 => {
            let exe = resolve_sidecar(app, NET8_SIDECAR).ok_or(
                "the .NET 8 C# sidecar (smallbasic-csharp-net8) is not available for this platform",
            )?;
            (Command::new(exe), session_dir.to_path_buf())
        }
        Backend::CSharpNet48 => {
            let program = resolve_staged_resource(app, NET48_PROGRAM).ok_or(
                "the .NET Framework 4.8 C# host (resources/dotnet/csharp-net48) is not available for this platform",
            )?;
            // A .NET Framework host is a folder deployment: run it from its own
            // directory so the framework resolves the sibling assemblies.
            let directory = program
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| session_dir.to_path_buf());
            (Command::new(program), directory)
        }
    };

    command.current_dir(working_directory);
    if debug {
        command.arg("debug");
    } else {
        command.args(["run", "--file"]);
        command.arg(program_path);
    }
    Ok(command)
}

fn kill_tree(pid: u32) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()?
            .wait()?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        // The sidecar was spawned as a process group leader; a negative pid
        // signals the whole tree.
        Command::new("kill")
            .args(["-9", &format!("-{pid}")])
            .spawn()?
            .wait()?;
        Ok(())
    }
}

fn emit(channel: &Channel<Value>, value: Value) {
    let _ = channel.send(value);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_parse_rejects_unknown() {
        assert!(Backend::parse("cli-csharp-net48").is_some());
        assert!(Backend::parse("cli-csharp-net8").is_some());
        // The Node/Blazor CLI backends and the single unversioned C# id were
        // removed (doc 10, §17.2).
        assert!(Backend::parse("cli-javascript").is_none());
        assert!(Backend::parse("cli-blazor").is_none());
        assert!(Backend::parse("cli-csharp").is_none());
        assert!(Backend::parse("cmd.exe").is_none());
    }

    #[test]
    fn staged_locations_match_the_packaging_contract() {
        // `bundle.externalBin` and `stage-playground.mjs` agree on this base
        // name (doc 10, §18.5).
        assert_eq!(NET8_SIDECAR, "smallbasic-csharp-net8");
        // The net48 host is a folder payload resolved through
        // `resolve_staged_resource`, not through `externalBin`.
        assert_eq!(NET48_PROGRAM, "resources/dotnet/csharp-net48/SmallBasic.RunHost.exe");
    }
}
