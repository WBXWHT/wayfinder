use serde::Serialize;
use serde_json::Value;
use shared_child::SharedChild;
use std::env;
use std::fs;
use std::io::Read;
#[cfg(unix)]
use std::os::unix::fs::MetadataExt as UnixMetadataExt;
#[cfg(unix)]
use std::os::unix::process::CommandExt as UnixCommandExt;
#[cfg(windows)]
use std::os::windows::fs::OpenOptionsExt as WindowsOpenOptionsExt;
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use std::os::windows::process::CommandExt as WindowsCommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
#[cfg(target_os = "macos")]
use tauri::WindowEvent;
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_shell::ShellExt;

const PROJECT_LOCK_STALE: Duration = Duration::from_secs(8);
/// Debounce window for coalescing bursts of transcript writes before a collect.
const COLLECT_DEBOUNCE: Duration = Duration::from_secs(2);
const COLLECT_RETRY_INTERVAL: Duration = Duration::from_secs(30);
const COLLECT_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Clone, Default)]
struct CollectGate {
    running: Arc<AtomicBool>,
    pending: Arc<AtomicBool>,
}

impl CollectGate {
    fn request(&self) -> bool {
        self.pending.store(true, Ordering::SeqCst);
        self.running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    fn begin_run(&self) {
        self.pending.store(false, Ordering::SeqCst);
    }

    fn finish_or_continue(&self) -> bool {
        if self.pending.swap(false, Ordering::SeqCst) {
            return true;
        }
        self.running.store(false, Ordering::SeqCst);
        self.pending.load(Ordering::SeqCst)
            && self
                .running
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSummary {
    id: String,
    name: String,
    root: String,
    updated_at: String,
    node_count: usize,
    pending_count: usize,
}

fn wayfinder_home() -> Result<PathBuf, String> {
    if let Some(value) = env::var_os("WAYFINDER_HOME") {
        return Ok(PathBuf::from(value));
    }
    dirs::home_dir()
        .map(|home| home.join(".wayfinder"))
        .ok_or_else(|| "Unable to resolve the local home directory".to_string())
}

fn state_path(project_id: &str) -> Result<PathBuf, String> {
    if !is_valid_project_id(project_id) {
        return Err("Invalid Wayfinder project id".to_string());
    }
    Ok(wayfinder_home()?
        .join("projects")
        .join(project_id)
        .join("timeline.json"))
}

fn is_valid_project_id(project_id: &str) -> bool {
    project_id.len() == 20 && project_id.chars().all(|value| value.is_ascii_hexdigit())
}

fn read_json(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Unable to read {}: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("Invalid Wayfinder data {}: {error}", path.display()))
}

#[tauri::command]
fn list_projects() -> Result<Vec<ProjectSummary>, String> {
    let projects_dir = wayfinder_home()?.join("projects");
    if !projects_dir.exists() {
        return Ok(Vec::new());
    }
    let mut projects = Vec::new();
    for entry in fs::read_dir(&projects_dir)
        .map_err(|error| format!("Unable to read {}: {error}", projects_dir.display()))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let id = entry.file_name().to_string_lossy().to_string();
        if !is_valid_project_id(&id) {
            continue;
        }
        let path = entry.path().join("timeline.json");
        if !path.is_file() {
            continue;
        }
        let state = match read_json(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let root = state
            .get("root")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let name = Path::new(&root)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Untitled project")
            .to_string();
        projects.push(ProjectSummary {
            id,
            name,
            root,
            updated_at: state
                .get("updatedAt")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            node_count: state
                .get("nodes")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0),
            pending_count: state
                .get("pending")
                .and_then(Value::as_object)
                .map(serde_json::Map::len)
                .unwrap_or(0),
        });
    }
    projects.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(projects)
}

#[tauri::command]
fn read_project_state(project_id: String) -> Result<Value, String> {
    read_json(&state_path(&project_id)?)
}

#[tauri::command]
fn open_data_folder() -> Result<String, String> {
    let home = wayfinder_home()?;
    fs::create_dir_all(&home)
        .map_err(|error| format!("Unable to create {}: {error}", home.display()))?;
    open_with_system(home.as_os_str(), "Wayfinder data folder")?;
    Ok(home.display().to_string())
}

#[tauri::command]
fn open_release_page() -> Result<(), String> {
    open_with_system(
        std::ffi::OsStr::new("https://github.com/StayCurious-Xuan/wayfinder/releases"),
        "Wayfinder release page",
    )
}

fn open_with_system(target: &std::ffi::OsStr, label: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let status = Command::new("/usr/bin/open").arg(target).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer.exe").arg(target).status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(target).status();

    let status = status.map_err(|error| format!("Unable to open {label}: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("The operating system could not open {label}"))
    }
}

#[tauri::command]
fn archive_project(project_id: String, force: Option<bool>) -> Result<String, String> {
    let state = state_path(&project_id)?;
    let project_dir = state
        .parent()
        .ok_or_else(|| "Invalid Wayfinder project directory".to_string())?;
    if !state.exists() {
        return Err("Wayfinder project no longer exists".to_string());
    }
    let mut lock = ProjectLock::acquire(&state)?;
    let current = read_json(&state)?;
    if current
        .get("pending")
        .and_then(Value::as_object)
        .is_some_and(|pending| !pending.is_empty())
        && force != Some(true)
    {
        return Err(
            "PENDING_TURNS: 项目仍有未完成的 AI 回合；确认宿主已停止后可强制归档。".to_string(),
        );
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let archive = wayfinder_home()?.join("archive");
    fs::create_dir_all(&archive)
        .map_err(|error| format!("Unable to create {}: {error}", archive.display()))?;
    let target = archive.join(format!("{project_id}-{timestamp}"));
    lock.ensure_owned()?;
    fs::rename(project_dir, &target)
        .map_err(|error| format!("Unable to archive project: {error}"))?;
    lock.relocate(target.join("timeline.json.lock"));
    Ok(target.display().to_string())
}

struct ProjectLock {
    state: Arc<Mutex<ProjectLockState>>,
    stop: Arc<AtomicBool>,
    heartbeat: Option<JoinHandle<()>>,
}

struct ProjectLockState {
    path: PathBuf,
    identity: LockIdentity,
    modified: SystemTime,
    compromised: bool,
}

#[derive(Clone, Copy, Eq, PartialEq)]
struct LockIdentity {
    first: u64,
    second: u64,
}

impl ProjectLock {
    fn acquire(state: &Path) -> Result<Self, String> {
        let lock = PathBuf::from(format!("{}.lock", state.display()));
        for _ in 0..2 {
            match fs::create_dir(&lock) {
                Ok(()) => {
                    let metadata = fs::metadata(&lock).map_err(|error| {
                        let _ = fs::remove_dir(&lock);
                        format!("Unable to inspect lock {}: {error}", lock.display())
                    })?;
                    let identity = lock_identity(&lock, &metadata).ok_or_else(|| {
                        let _ = fs::remove_dir(&lock);
                        format!("Unable to identify lock {}", lock.display())
                    })?;
                    let modified = refresh_lock(&lock, identity, None).ok_or_else(|| {
                        let _ = fs::remove_dir(&lock);
                        format!("Unable to initialize lock {}", lock.display())
                    })?;
                    let state = Arc::new(Mutex::new(ProjectLockState {
                        path: lock,
                        identity,
                        modified,
                        compromised: false,
                    }));
                    let stop = Arc::new(AtomicBool::new(false));
                    let thread_state = Arc::clone(&state);
                    let thread_stop = Arc::clone(&stop);
                    let heartbeat = thread::spawn(move || {
                        while !thread_stop.load(Ordering::Acquire) {
                            thread::park_timeout(Duration::from_secs(2));
                            if thread_stop.load(Ordering::Acquire) {
                                break;
                            }
                            if let Ok(mut current) = thread_state.lock() {
                                if let Some(modified) = refresh_lock(
                                    &current.path,
                                    current.identity,
                                    Some(current.modified),
                                ) {
                                    current.modified = modified;
                                } else {
                                    current.compromised = true;
                                    break;
                                }
                            }
                        }
                    });
                    return Ok(Self {
                        state,
                        stop,
                        heartbeat: Some(heartbeat),
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    if recover_stale_lock(&lock) {
                        continue;
                    }
                    return Err("项目正在记录新航迹，请在 AI 会话结束后重试。".to_string());
                }
                Err(error) => {
                    return Err(format!("Unable to lock {}: {error}", state.display()));
                }
            }
        }
        Err("Unable to acquire the Wayfinder project lock".to_string())
    }

    fn relocate(&mut self, path: PathBuf) {
        if let Ok(mut state) = self.state.lock() {
            state.path = path;
            if let Some(modified) =
                lock_modified_if_owned(&state.path, state.identity, state.modified)
            {
                state.modified = modified;
                return;
            }
            state.compromised = true;
        }
    }

    fn ensure_owned(&self) -> Result<(), String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Wayfinder project lock state is unavailable".to_string())?;
        let owned = !state.compromised
            && lock_modified_if_owned(&state.path, state.identity, state.modified).is_some();
        if owned {
            Ok(())
        } else {
            Err("Wayfinder project lock ownership was lost".to_string())
        }
    }
}

fn lock_modified_if_owned(
    lock: &Path,
    identity: LockIdentity,
    expected: SystemTime,
) -> Option<SystemTime> {
    let metadata = fs::metadata(lock).ok()?;
    let modified = metadata.modified().ok()?;
    (lock_identity(lock, &metadata) == Some(identity) && modified == expected).then_some(modified)
}

fn refresh_lock(
    lock: &Path,
    identity: LockIdentity,
    expected: Option<SystemTime>,
) -> Option<SystemTime> {
    let now = SystemTime::now();
    let before = fs::metadata(lock).ok()?;
    if lock_identity(lock, &before) != Some(identity)
        || expected.is_some_and(|modified| before.modified().ok() != Some(modified))
    {
        return None;
    }
    filetime::set_file_mtime(lock, filetime::FileTime::from_system_time(now)).ok()?;
    let after = fs::metadata(lock).ok()?;
    let modified = after.modified().ok()?;
    if lock_identity(lock, &after) != Some(identity)
        || fs::metadata(lock)
            .ok()
            .filter(|metadata| lock_identity(lock, metadata) == Some(identity))?
            .modified()
            .ok()
            != Some(modified)
    {
        return None;
    }
    Some(modified)
}

fn recover_stale_lock(lock: &Path) -> bool {
    let owner = lock.join("owner");
    let legacy = owner.is_file();
    let observed = match fs::metadata(lock) {
        Ok(metadata) => metadata,
        Err(_) => return false,
    };
    let Some(observed_identity) = lock_identity(lock, &observed) else {
        return false;
    };
    let modified = fs::metadata(&owner)
        .or_else(|_| fs::metadata(lock))
        .and_then(|metadata| metadata.modified())
        .ok();
    let Some(observed_modified) = modified else {
        return false;
    };
    if !SystemTime::now()
        .duration_since(observed_modified)
        .ok()
        .is_some_and(|age| age > PROJECT_LOCK_STALE)
    {
        return false;
    }
    quarantine_stale_lock(lock, observed_identity, observed_modified, legacy)
}

fn quarantine_stale_lock(
    lock: &Path,
    observed_identity: LockIdentity,
    observed_modified: SystemTime,
    legacy: bool,
) -> bool {
    let quarantine = lock.with_file_name(format!(
        "{}.reclaim-{}-{}",
        lock.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("wayfinder.lock"),
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0)
    ));
    if fs::rename(lock, &quarantine).is_err() {
        return false;
    }
    let same_lock = fs::metadata(&quarantine)
        .ok()
        .is_some_and(|metadata| lock_identity(&quarantine, &metadata) == Some(observed_identity));
    let timestamp_path = if legacy {
        quarantine.join("owner")
    } else {
        quarantine.clone()
    };
    let unchanged = fs::metadata(timestamp_path)
        .and_then(|metadata| metadata.modified())
        .ok()
        == Some(observed_modified);
    if !same_lock || !unchanged {
        if !lock.exists() {
            let _ = fs::rename(&quarantine, lock);
        }
        return false;
    }
    if legacy {
        fs::remove_dir_all(&quarantine).is_ok()
    } else {
        fs::remove_dir(&quarantine).is_ok()
    }
}

#[cfg(unix)]
fn lock_identity(_path: &Path, metadata: &fs::Metadata) -> Option<LockIdentity> {
    Some(LockIdentity {
        first: metadata.dev(),
        second: metadata.ino(),
    })
}

#[cfg(windows)]
fn lock_identity(path: &Path, _metadata: &fs::Metadata) -> Option<LockIdentity> {
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    let directory = fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
        .ok()?;
    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    let succeeded =
        unsafe { GetFileInformationByHandle(directory.as_raw_handle() as _, &mut information) };
    if succeeded == 0 {
        return None;
    }
    Some(LockIdentity {
        first: information.dwVolumeSerialNumber as u64,
        second: (u64::from(information.nFileIndexHigh) << 32)
            | u64::from(information.nFileIndexLow),
    })
}

impl Drop for ProjectLock {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(heartbeat) = self.heartbeat.take() {
            heartbeat.thread().unpark();
            let _ = heartbeat.join();
        }
        if let Ok(state) = self.state.lock() {
            let still_owned = !state.compromised
                && lock_modified_if_owned(&state.path, state.identity, state.modified).is_some();
            if still_owned {
                let _ = fs::remove_dir(&state.path);
            }
        }
    }
}

#[derive(Clone, Default)]
struct ActiveCollector {
    child: Arc<Mutex<Option<Arc<SharedChild>>>>,
    shutting_down: Arc<AtomicBool>,
}

fn kill_collector_process(child: Arc<SharedChild>) {
    let pid = child.id();
    #[cfg(unix)]
    {
        // The sidecar starts in its own process group, so one signal reaches
        // Node and every Git process it spawned without a PID-enumeration race.
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut taskkill = Command::new("taskkill.exe");
        taskkill.creation_flags(CREATE_NO_WINDOW);
        let _ = taskkill
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

impl ActiveCollector {
    fn replace(&self, child: Arc<SharedChild>) -> Result<u32, String> {
        let pid = child.id();
        if self.shutting_down.load(Ordering::Acquire) {
            kill_collector_process(child);
            return Err("collector is shutting down".to_string());
        }
        let mut current = self
            .child
            .lock()
            .map_err(|_| "Collector process state is unavailable".to_string())?;
        if self.shutting_down.load(Ordering::Acquire) {
            kill_collector_process(child);
            return Err("collector is shutting down".to_string());
        }
        if let Some(previous) = current.take() {
            kill_collector_process(previous);
        }
        *current = Some(child);
        Ok(pid)
    }

    fn clear(&self, pid: u32) {
        if let Ok(mut current) = self.child.lock() {
            if current.as_ref().is_some_and(|child| child.id() == pid) {
                current.take();
            }
        }
    }

    fn cancel_current(&self) {
        if let Ok(mut current) = self.child.lock() {
            if let Some(child) = current.take() {
                kill_collector_process(child);
            }
        }
    }

    fn shutdown(&self) {
        self.shutting_down.store(true, Ordering::Release);
        self.cancel_current();
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CollectorStatus {
    status: String,
    message: Option<String>,
}

fn emit_collector_status(app: &AppHandle, status: &str, message: Option<String>) {
    let _ = app.emit(
        "wayfinder://collector-status",
        CollectorStatus {
            status: status.to_string(),
            message,
        },
    );
}

async fn run_collect_once(app: &AppHandle, active: &ActiveCollector) -> Result<(), String> {
    let sidecar = app
        .shell()
        .sidecar("wayfinder")
        .map_err(|error| format!("sidecar unavailable: {error}"))?
        .args(["collect"]);
    let mut command: Command = sidecar.into();
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let child = Arc::new(
        SharedChild::spawn(&mut command)
            .map_err(|error| format!("unable to start collector: {error}"))?,
    );
    let Some(stdout) = child.take_stdout() else {
        kill_collector_process(child);
        return Err("collector stdout is unavailable".to_string());
    };
    let Some(stderr) = child.take_stderr() else {
        kill_collector_process(child);
        return Err("collector stderr is unavailable".to_string());
    };
    let pid = active.replace(Arc::clone(&child))?;
    let mut wait_task = tauri::async_runtime::spawn_blocking(move || {
        let stdout_reader = thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = std::io::BufReader::new(stdout).read_to_end(&mut bytes);
            bytes
        });
        let stderr_reader = thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = std::io::BufReader::new(stderr).read_to_end(&mut bytes);
            bytes
        });
        let status = child
            .wait()
            .map_err(|error| format!("unable to wait for collector: {error}"))?;
        let _ = stdout_reader.join();
        let stderr = stderr_reader.join().unwrap_or_default();
        if status.success() {
            Ok(())
        } else {
            let detail = String::from_utf8_lossy(&stderr).trim().to_string();
            Err(if detail.is_empty() {
                format!("collector exited with status {:?}", status.code())
            } else {
                detail
            })
        }
    });
    let result = tokio::time::timeout(COLLECT_TIMEOUT, &mut wait_task).await;
    match result {
        Ok(Ok(Ok(()))) => {
            active.clear(pid);
            Ok(())
        }
        Ok(Ok(Err(error))) => {
            active.clear(pid);
            Err(error)
        }
        Ok(Err(error)) => {
            active.cancel_current();
            Err(format!("collector wait task failed: {error}"))
        }
        Err(_) => {
            active.cancel_current();
            let _ = tokio::time::timeout(Duration::from_secs(2), &mut wait_task).await;
            Err(format!(
                "collector timed out after {} seconds",
                COLLECT_TIMEOUT.as_secs()
            ))
        }
    }
}

/// Transcript directories every comparable local tool watches: Codex rollouts
/// and Claude Code project logs. Desktop clients write here even when no
/// lifecycle hook fires, so watching them is what makes background capture work.
fn transcript_watch_roots() -> Vec<PathBuf> {
    resolve_transcript_roots(
        env::var_os("CODEX_SESSIONS_ROOT").map(PathBuf::from),
        env::var_os("CODEX_HOME").map(PathBuf::from),
        env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from),
        dirs::home_dir(),
    )
}

/// Pure resolver (env passed in) so the precedence rules can be unit-tested
/// without mutating process-wide environment variables.
fn resolve_transcript_roots(
    codex_sessions_root: Option<PathBuf>,
    codex_home: Option<PathBuf>,
    claude_config_dir: Option<PathBuf>,
    home: Option<PathBuf>,
) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(root) = codex_sessions_root {
        roots.push(root);
    } else if let Some(codex_home) = codex_home {
        roots.push(codex_home.join("sessions"));
    } else if let Some(home) = home.clone() {
        roots.push(home.join(".codex").join("sessions"));
    }
    if let Some(claude) = claude_config_dir {
        roots.push(claude.join("projects"));
    } else if let Some(home) = home {
        roots.push(home.join(".claude").join("projects"));
    }
    roots
}

/// Schedule `wayfinder collect` through the bundled sidecar. A burst received
/// during a run is collapsed into one follow-up pass.
fn schedule_collect(app: &AppHandle, gate: &CollectGate) {
    if !gate.request() {
        return;
    }
    let app = app.clone();
    let gate = gate.clone();
    let active = app.state::<ActiveCollector>().inner().clone();
    tauri::async_runtime::spawn(async move {
        loop {
            gate.begin_run();
            emit_collector_status(&app, "running", None);
            match run_collect_once(&app, &active).await {
                Ok(()) => emit_collector_status(&app, "idle", None),
                Err(error) => {
                    eprintln!("wayfinder collect failed: {error}");
                    emit_collector_status(&app, "error", Some(error));
                }
            }
            if !gate.finish_or_continue() {
                break;
            }
        }
    });
}

/// Start a debounced filesystem watcher over the transcript roots. On any
/// change (new session, appended turn) it triggers a collect after a short
/// debounce. Content collection remains event-driven; a lightweight existence
/// check attaches watchers to roots created after Wayfinder starts.
fn start_transcript_watcher(app: AppHandle) {
    // Use the notify re-exported by the debouncer to avoid version skew.
    use notify_debouncer_mini::notify::RecursiveMode;
    use notify_debouncer_mini::{new_debouncer, DebounceEventResult};

    thread::spawn(move || {
        let collect_gate = CollectGate::default();
        // Collect once at startup so sessions written while the app was closed
        // are captured immediately.
        schedule_collect(&app, &collect_gate);
        let mut last_retry = Instant::now();

        loop {
            let roots: Vec<PathBuf> = transcript_watch_roots()
                .into_iter()
                .filter(|root| root.exists())
                .collect();
            if roots.is_empty() {
                thread::sleep(Duration::from_secs(2));
                continue;
            }

            let handler_app = app.clone();
            let handler_gate = collect_gate.clone();
            let debouncer = new_debouncer(COLLECT_DEBOUNCE, move |result: DebounceEventResult| {
                if let Ok(events) = result {
                    if !events.is_empty() {
                        schedule_collect(&handler_app, &handler_gate);
                    }
                }
            });
            let mut debouncer = match debouncer {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("wayfinder watcher: failed to start: {error}");
                    thread::sleep(Duration::from_secs(2));
                    continue;
                }
            };
            let mut watched_roots = Vec::new();
            let mut failed_roots = Vec::new();
            for root in &roots {
                match debouncer.watcher().watch(root, RecursiveMode::Recursive) {
                    Ok(()) => watched_roots.push(root.clone()),
                    Err(error) => {
                        eprintln!("wayfinder watcher: cannot watch {root:?}: {error}");
                        failed_roots.push(root.clone());
                    }
                }
            }
            if watched_roots.is_empty() {
                thread::sleep(Duration::from_secs(2));
                continue;
            }
            // Capture files created before the watcher was attached.
            schedule_collect(&app, &collect_gate);

            loop {
                thread::sleep(Duration::from_secs(2));
                if last_retry.elapsed() >= COLLECT_RETRY_INTERVAL {
                    schedule_collect(&app, &collect_gate);
                    last_retry = Instant::now();
                }
                let current: Vec<PathBuf> = transcript_watch_roots()
                    .into_iter()
                    .filter(|root| root.exists())
                    .collect();
                if current != roots {
                    schedule_collect(&app, &collect_gate);
                    break;
                }
                failed_roots.retain(|root| {
                    match debouncer.watcher().watch(root, RecursiveMode::Recursive) {
                        Ok(()) => {
                            watched_roots.push(root.clone());
                            false
                        }
                        Err(error) => {
                            eprintln!("wayfinder watcher: cannot watch {root:?}: {error}");
                            true
                        }
                    }
                });
            }
        }
    });
}

fn main() {
    let app = tauri::Builder::default()
        .manage(ActiveCollector::default())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            start_transcript_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            read_project_state,
            open_data_folder,
            open_release_page,
            archive_project
        ])
        .build(tauri::generate_context!())
        .expect("error while running Wayfinder Companion");
    app.run(|app, event| match event {
        #[cfg(target_os = "macos")]
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            api.prevent_close();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        RunEvent::Exit | RunEvent::ExitRequested { .. } => {
            app.state::<ActiveCollector>().shutdown();
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::Ordering;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use super::{
        lock_identity, quarantine_stale_lock, state_path, ActiveCollector, CollectGate,
        ProjectLock, PROJECT_LOCK_STALE,
    };

    #[test]
    fn collect_gate_coalesces_requests_into_one_follow_up_run() {
        let gate = CollectGate::default();
        assert!(gate.request());
        gate.begin_run();
        assert!(!gate.request());
        assert!(!gate.request());
        assert!(gate.finish_or_continue());
        gate.begin_run();
        assert!(!gate.finish_or_continue());
        assert!(gate.request());
    }

    #[test]
    fn collector_shutdown_is_irreversible() {
        let active = ActiveCollector::default();
        assert!(!active.shutting_down.load(Ordering::Acquire));
        active.cancel_current();
        assert!(!active.shutting_down.load(Ordering::Acquire));
        active.shutdown();
        assert!(active.shutting_down.load(Ordering::Acquire));
    }

    #[test]
    fn project_ids_cannot_escape_the_wayfinder_directory() {
        assert!(state_path("../../Library").is_err());
        assert!(state_path("0123456789abcdef0123").is_ok());
    }

    #[test]
    fn transcript_roots_follow_env_precedence() {
        use super::resolve_transcript_roots;
        use std::path::PathBuf;

        // Defaults from home when no overrides are set.
        let roots = resolve_transcript_roots(None, None, None, Some(PathBuf::from("/Users/x")));
        assert_eq!(
            roots,
            vec![
                PathBuf::from("/Users/x/.codex/sessions"),
                PathBuf::from("/Users/x/.claude/projects"),
            ]
        );

        // Explicit overrides win, and CODEX_SESSIONS_ROOT beats CODEX_HOME.
        let roots = resolve_transcript_roots(
            Some(PathBuf::from("/custom/sessions")),
            Some(PathBuf::from("/ignored/codex")),
            Some(PathBuf::from("/custom/claude")),
            Some(PathBuf::from("/Users/x")),
        );
        assert_eq!(
            roots,
            vec![
                PathBuf::from("/custom/sessions"),
                PathBuf::from("/custom/claude/projects"),
            ]
        );
    }

    #[test]
    fn project_lock_is_released_when_the_guard_drops() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("wayfinder-lock-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&dir).expect("test directory");
        let state = dir.join("timeline.json");
        let lock = dir.join("timeline.json.lock");
        {
            let _guard = ProjectLock::acquire(&state).expect("lock");
            assert!(lock.is_dir());
            assert_eq!(fs::read_dir(&lock).expect("read lock directory").count(), 0);
        }
        assert!(!lock.exists());
        fs::remove_dir_all(dir).expect("remove test directory");
    }

    #[test]
    fn replaced_lock_is_neither_refreshed_nor_removed() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("wayfinder-stolen-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&dir).expect("test directory");
        let state = dir.join("timeline.json");
        let lock = dir.join("timeline.json.lock");
        let guard = ProjectLock::acquire(&state).expect("lock");
        fs::remove_dir(&lock).expect("remove owned lock");
        fs::create_dir(&lock).expect("replacement lock");
        filetime::set_file_mtime(
            &lock,
            filetime::FileTime::from_system_time(SystemTime::now() - Duration::from_secs(1)),
        )
        .expect("replacement timestamp");
        assert!(guard.ensure_owned().is_err());
        drop(guard);
        assert!(lock.is_dir());
        fs::remove_dir_all(dir).expect("remove test directory");
    }

    #[test]
    fn stale_lock_directory_is_recovered() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("wayfinder-stale-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&dir).expect("test directory");
        let state = dir.join("timeline.json");
        let lock = dir.join("timeline.json.lock");
        fs::create_dir(&lock).expect("stale lock");
        let stale_at = SystemTime::now() - PROJECT_LOCK_STALE - Duration::from_secs(1);
        filetime::set_file_mtime(&lock, filetime::FileTime::from_system_time(stale_at))
            .expect("age stale lock");

        let guard = ProjectLock::acquire(&state).expect("recover stale lock");
        assert!(guard.ensure_owned().is_ok());
        drop(guard);
        assert!(!lock.exists());
        fs::remove_dir_all(dir).expect("remove test directory");
    }

    #[test]
    fn refreshed_lock_is_restored_instead_of_reclaimed() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("wayfinder-live-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&dir).expect("test directory");
        let lock = dir.join("timeline.json.lock");
        fs::create_dir(&lock).expect("stale lock");
        let stale_at = SystemTime::now() - PROJECT_LOCK_STALE - Duration::from_secs(1);
        filetime::set_file_mtime(&lock, filetime::FileTime::from_system_time(stale_at))
            .expect("age stale lock");
        let observed = fs::metadata(&lock).expect("observe stale lock");
        let observed_identity = lock_identity(&lock, &observed).expect("lock identity");
        let observed_modified = observed.modified().expect("stale modified time");

        filetime::set_file_mtime(
            &lock,
            filetime::FileTime::from_system_time(SystemTime::now()),
        )
        .expect("refresh live lock");
        assert!(!quarantine_stale_lock(
            &lock,
            observed_identity,
            observed_modified,
            false
        ));
        assert!(lock.is_dir());
        fs::remove_dir_all(dir).expect("remove test directory");
    }

    #[test]
    fn legacy_nonempty_stale_lock_is_recovered() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("wayfinder-legacy-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&dir).expect("test directory");
        let state = dir.join("timeline.json");
        let lock = dir.join("timeline.json.lock");
        fs::create_dir(&lock).expect("legacy stale lock");
        let owner = lock.join("owner");
        fs::write(&owner, "legacy").expect("legacy owner");
        let stale_at = SystemTime::now() - PROJECT_LOCK_STALE - Duration::from_secs(1);
        filetime::set_file_mtime(&owner, filetime::FileTime::from_system_time(stale_at))
            .expect("age legacy owner");

        let guard = ProjectLock::acquire(&state).expect("recover legacy lock");
        assert!(guard.ensure_owned().is_ok());
        assert_eq!(fs::read_dir(&lock).expect("read lock directory").count(), 0);
        drop(guard);
        assert!(!lock.exists());
        fs::remove_dir_all(dir).expect("remove test directory");
    }
}
