use serde::Serialize;
use serde_json::Value;
use std::env;
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

const PROJECT_LOCK_STALE: Duration = Duration::from_secs(8);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSummary {
    id: String,
    name: String,
    root: String,
    updated_at: String,
    node_count: usize,
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
    if project_id.len() != 20 || !project_id.chars().all(|value| value.is_ascii_hexdigit()) {
        return Err("Invalid Wayfinder project id".to_string());
    }
    Ok(wayfinder_home()?
        .join("projects")
        .join(project_id)
        .join("timeline.json"))
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
    let status = Command::new("/usr/bin/open")
        .arg(&home)
        .status()
        .map_err(|error| error.to_string())?;
    if !status.success() {
        return Err("macOS could not open the Wayfinder data folder".to_string());
    }
    Ok(home.display().to_string())
}

#[tauri::command]
fn open_release_page() -> Result<(), String> {
    let status = Command::new("/usr/bin/open")
        .arg("https://github.com/WBXWHT/wayfinder/releases")
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("macOS could not open the Wayfinder release page".to_string())
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
    inode: u64,
    modified: SystemTime,
    compromised: bool,
}

impl ProjectLock {
    fn acquire(state: &Path) -> Result<Self, String> {
        let lock = PathBuf::from(format!("{}.lock", state.display()));
        for _ in 0..2 {
            match fs::create_dir(&lock) {
                Ok(()) => {
                    let identity = refresh_lock(&lock, None).ok_or_else(|| {
                        let _ = fs::remove_dir(&lock);
                        format!("Unable to initialize lock {}", lock.display())
                    })?;
                    let state = Arc::new(Mutex::new(ProjectLockState {
                        path: lock,
                        inode: identity.inode,
                        modified: identity.modified,
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
                                let expected = LockIdentity {
                                    inode: current.inode,
                                    modified: current.modified,
                                };
                                if let Some(identity) = refresh_lock(&current.path, Some(expected))
                                {
                                    current.inode = identity.inode;
                                    current.modified = identity.modified;
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
                    if lock_is_stale(&lock) && fs::remove_dir(&lock).is_ok() {
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
            if let Ok(metadata) = fs::metadata(&state.path) {
                state.inode = metadata.ino();
                if let Ok(modified) = metadata.modified() {
                    state.modified = modified;
                    return;
                }
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
            && fs::metadata(&state.path).is_ok_and(|metadata| {
                metadata.ino() == state.inode
                    && metadata
                        .modified()
                        .is_ok_and(|modified| modified == state.modified)
            });
        if owned {
            Ok(())
        } else {
            Err("Wayfinder project lock ownership was lost".to_string())
        }
    }
}

#[derive(Clone, Copy)]
struct LockIdentity {
    inode: u64,
    modified: SystemTime,
}

fn refresh_lock(lock: &Path, expected: Option<LockIdentity>) -> Option<LockIdentity> {
    let now = SystemTime::now();
    let file = fs::File::open(lock).ok()?;
    let before = file.metadata().ok()?;
    if expected.is_some_and(|identity| {
        before.ino() != identity.inode || before.modified().ok() != Some(identity.modified)
    }) {
        return None;
    }
    if fs::metadata(lock).ok()?.ino() != before.ino() {
        return None;
    }
    file.set_times(fs::FileTimes::new().set_modified(now))
        .ok()?;
    let after = file.metadata().ok()?;
    let path_after = fs::metadata(lock).ok()?;
    let modified = after.modified().ok()?;
    if path_after.ino() != after.ino() || path_after.modified().ok() != Some(modified) {
        return None;
    }
    Some(LockIdentity {
        inode: after.ino(),
        modified,
    })
}

fn lock_is_stale(lock: &Path) -> bool {
    fs::metadata(lock)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|age| age > PROJECT_LOCK_STALE)
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
                && fs::metadata(&state.path).is_ok_and(|metadata| {
                    metadata.ino() == state.inode
                        && metadata
                            .modified()
                            .is_ok_and(|modified| modified == state.modified)
                });
            if still_owned {
                let _ = fs::remove_dir(&state.path);
            }
        }
    }
}

#[tauri::command]
async fn connect_host(app: AppHandle, host: String) -> Result<String, String> {
    validate_host(&host)?;
    ensure_stable_install_location()?;
    let output = app
        .shell()
        .sidecar("wayfinder")
        .map_err(|error| error.to_string())?
        .args(["connect", host.as_str()])
        .output()
        .await
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let name = if host == "claude" {
        "Claude Code"
    } else {
        "Codex"
    };
    Ok(format!(
        "{name} Hook 已配置。请重启宿主并批准 Wayfinder Hook。"
    ))
}

#[tauri::command]
async fn disconnect_host(app: AppHandle, host: String) -> Result<String, String> {
    validate_host(&host)?;
    let output = app
        .shell()
        .sidecar("wayfinder")
        .map_err(|error| error.to_string())?
        .args(["disconnect", host.as_str()])
        .output()
        .await
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let name = if host == "claude" {
        "Claude Code"
    } else {
        "Codex"
    };
    Ok(format!("{name} 已断开。"))
}

#[tauri::command]
async fn host_status(app: AppHandle) -> Result<Value, String> {
    let output = app
        .shell()
        .sidecar("wayfinder")
        .map_err(|error| error.to_string())?
        .args(["doctor", "--global"])
        .output()
        .await
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Invalid Wayfinder status: {error}"))
}

fn validate_host(host: &str) -> Result<(), String> {
    if host == "claude" || host == "codex" {
        Ok(())
    } else {
        Err("Wayfinder supports Claude Code and Codex".to_string())
    }
}

fn ensure_stable_install_location() -> Result<(), String> {
    let executable = env::current_exe().map_err(|error| error.to_string())?;
    validate_install_path(&executable)
}

fn validate_install_path(executable: &Path) -> Result<(), String> {
    let path = executable.to_string_lossy();
    if executable.starts_with("/Volumes/") || path.contains("/AppTranslocation/") {
        return Err("请先把 Wayfinder 拖入“应用程序”文件夹，再连接 AI 工具。".to_string());
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            list_projects,
            read_project_state,
            open_data_folder,
            open_release_page,
            archive_project,
            connect_host,
            disconnect_host,
            host_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running Wayfinder Companion");
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{state_path, validate_install_path, ProjectLock};

    #[test]
    fn project_ids_cannot_escape_the_wayfinder_directory() {
        assert!(state_path("../../Library").is_err());
        assert!(state_path("0123456789abcdef0123").is_ok());
    }

    #[test]
    fn mounted_dmg_cannot_install_persistent_hooks() {
        assert!(validate_install_path(Path::new(
            "/Volumes/Wayfinder/Wayfinder.app/Contents/MacOS/wayfinder-companion"
        ))
        .is_err());
        assert!(validate_install_path(Path::new(
            "/Applications/Wayfinder.app/Contents/MacOS/wayfinder-companion"
        ))
        .is_ok());
        assert!(validate_install_path(Path::new(
            "/private/var/folders/ab/cd/T/AppTranslocation/ABC/d/Wayfinder.app/Contents/MacOS/wayfinder-companion"
        )).is_err());
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
        assert!(guard.ensure_owned().is_err());
        drop(guard);
        assert!(lock.is_dir());
        fs::remove_dir_all(dir).expect("remove test directory");
    }
}
