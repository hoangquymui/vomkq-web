use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use zip::ZipArchive;

const MODEL: &str = "hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M";
const OLLAMA_URL: &str = "http://127.0.0.1:11434";
const BACKEND_URL: &str = "http://127.0.0.1:8000";
const BACKEND_SERVICE: &str = "vector-ai-python-core";
const BACKEND_PROTOCOL_VERSION: u32 = 2;
const BACKEND_BUILD_ID: &str = "2026-09-09.1";

const SYSTEM_PROMPT: &str = r#"Bạn là VECTOR AI, một trợ lý AI offline mạnh mẽ chạy cục bộ.
Trả lời bằng tiếng Việt rõ ràng, chính xác và tự nhiên, trừ khi người dùng yêu cầu ngôn ngữ khác.
Với toán và vật lý: đọc đúng đại lượng được hỏi, nêu công thức, thay số, kiểm tra đơn vị và kết luận đúng trọng tâm. Không tự bịa dữ kiện. Với bài nhiều giai đoạn, phải giữ nhất quán mốc tọa độ, mốc thế năng và chiều dương; kiểm tra lại dấu lực, điều kiện biên và thay kết quả ngược vào công thức trước khi kết luận. Nếu đề bài có cách hiểu hình học chưa rõ, nêu giả thiết đang dùng thay vì âm thầm đổi quy ước giữa chừng.
Trình bày Markdown gọn đẹp; không mở đầu xã giao, không chép lại đề và không giải thích nguồn không liên quan. Mặc định một bài toán thông thường không quá khoảng 700 token, trừ khi người dùng yêu cầu lời giải rất chi tiết. Công thức trong dòng đặt trong \( ... \), công thức độc lập đặt trong \[ ... \]. Với hệ phương trình, dùng \begin{cases} ... \end{cases}, dùng & để căn theo dấu bằng và \\ để xuống dòng. Không viết lệnh LaTeX trần bên ngoài delimiter.
Khi người dùng yêu cầu sơ đồ, xuất duy nhất mã Mermaid hợp lệ trong khối ```mermaid. Khi yêu cầu biểu đồ dữ liệu hoặc đồ thị, xuất cấu hình Chart.js JSON hợp lệ trong khối ```chart, gồm type, data và options; không dùng hàm JavaScript trong JSON. Giải thích ngắn bên ngoài khối nếu cần.
Với đề có nhiều yêu cầu đánh số, phải giải đủ từng yêu cầu và tự kiểm đếm lại trước khi kết luận. Chỉ sau khi hoàn tất toàn bộ yêu cầu mới tạo đúng một khối kết quả duy nhất ở cuối phản hồi, theo đúng định dạng sau:
:::result
Vận tốc | 12 m/s
Thời gian | 5 s
:::
Mỗi yêu cầu phải có ít nhất một dòng kết quả và bắt buộc dùng dấu | để ngăn tên với giá trị. Cột tên phải dùng tên ngắn gọn, cụ thể mà người dùng cần xem, ví dụ Gạo, Thịt, Cá, Rau hoặc Vận tốc, Thời gian; không dùng nhãn chung như Câu 1, Mục 1, Kết quả. Không chèn dòng "Tên đại lượng | Giá trị" hay bảng kết quả tạm giữa các bước. Chỉ đặt kết quả cuối vào khối, không đặt bước biến đổi, không tạo khối sau từng câu và không viết thêm nội dung sau dấu đóng. Không dùng khối này cho trò chuyện thông thường không có đáp số.
Trước khi viết một phản hồi dài, phải tự phân bổ dung lượng và dành ít nhất 15% phần cuối để hoàn tất công thức đang viết, đóng mọi delimiter LaTeX hoặc khối mã, nêu kết luận ngắn và bảng kết quả. Nếu nhận thấy không đủ chỗ, chỉ dừng sau một câu hoặc công thức hoàn chỉnh rồi ghi "Còn tiếp". Tuyệt đối không bắt đầu công thức mới khi sắp chạm giới hạn phản hồi.
Chỉ đưa ra lời giải cần thiết và không lặp lại nguyên văn phần suy luận trong câu trả lời cuối."#;

struct CancelState(Mutex<HashSet<String>>);

struct BackendProcess {
    child: std::process::Child,
    instance_token: String,
}

struct BackendState(Mutex<Option<BackendProcess>>);

struct OllamaState(Mutex<Option<std::process::Child>>);

#[derive(Debug, Clone, Default, Deserialize)]
struct BackendHealth {
    #[serde(default)]
    status: String,
    #[serde(default)]
    service: String,
    #[serde(default)]
    protocol_version: u32,
    #[serde(default)]
    build_id: String,
    #[serde(default)]
    instance_token: String,
    #[serde(default)]
    pid: u32,
    #[serde(default)]
    parent_pid: u32,
}

#[derive(Debug, Deserialize)]
struct BackendOwnerMarker {
    service: String,
    instance_token: String,
    pid: u32,
    #[serde(default)]
    parent_pid: u32,
    #[serde(default)]
    managed_by_app: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatMessage {
    role: String,
    content: String,
    #[serde(default)]
    images: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRequest {
    request_id: String,
    messages: Vec<ChatMessage>,
    // Legacy fallback only: false = FAST (thinking off), true = DEEP (thinking on).
    #[serde(default)]
    reasoning: bool,
    #[serde(default)]
    mode: String,
    #[serde(default)]
    model: String,
}

fn backend_port_is_open() -> bool {
    "127.0.0.1:8000"
        .parse()
        .ok()
        .and_then(|address| {
            std::net::TcpStream::connect_timeout(&address, Duration::from_millis(250)).ok()
        })
        .is_some()
}

fn backend_health_matches(health: &BackendHealth, expected_token: Option<&str>) -> bool {
    health.status == "ready"
        && health.service == BACKEND_SERVICE
        && health.protocol_version == BACKEND_PROTOCOL_VERSION
        && health.build_id == BACKEND_BUILD_ID
        && expected_token
            .map(|token| health.instance_token == token)
            .unwrap_or(true)
}

async fn backend_health() -> Result<Option<BackendHealth>, String> {
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_millis(350))
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|error| format!("Không thể tạo bộ kiểm tra Python Core: {error}"))?;
    let response = match http
        .get(format!("{BACKEND_URL}/api/v1/health"))
        .send()
        .await
    {
        Ok(response) => response,
        Err(_error) if !backend_port_is_open() => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Cổng 127.0.0.1:8000 đang mở nhưng không trả lời như Python Core: {error}"
            ))
        }
    };
    if !response.status().is_success() {
        return Err(format!(
            "Cổng 127.0.0.1:8000 trả HTTP {} thay vì trạng thái Python Core.",
            response.status()
        ));
    }
    response
        .json::<BackendHealth>()
        .await
        .map(Some)
        .map_err(|error| format!("Dịch vụ ở cổng 8000 không phải Python Core hợp lệ: {error}"))
}

fn vector_data_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("VECTOR_AI")
}

fn project_root() -> PathBuf {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("VECTOR_AI_PROJECT_DIR") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(exe) = std::env::current_exe() {
        candidates.extend(exe.ancestors().skip(1).take(8).map(Path::to_path_buf));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd);
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.parent().unwrap_or(&manifest).to_path_buf());
    candidates.into_iter().find(|path| path.join("backend/vector_ai_backend").is_dir())
        .unwrap_or(manifest)
}

fn runtime_bundle_at(project: &Path) -> Option<PathBuf> {
    let runtime = project.join("runtime");
    let raw = std::fs::read_to_string(runtime.join("active.json")).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    let relative = Path::new(value.get("bundle")?.as_str()?);
    if relative.as_os_str().is_empty() || !relative.components().all(|c| matches!(c, std::path::Component::Normal(_))) {
        return None;
    }
    let root = runtime.canonicalize().ok()?;
    let bundle = runtime.join(relative).canonicalize().ok()?;
    (bundle.starts_with(root) && bundle.is_dir()).then_some(bundle)
}

fn backend_marker_path() -> PathBuf {
    vector_data_dir().join("work/backend-owner.json")
}

fn remove_backend_marker_if_owned(instance_token: &str) {
    let path = backend_marker_path();
    let owned = std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<BackendOwnerMarker>(&raw).ok())
        .is_some_and(|marker| {
            marker.managed_by_app
                && marker.service == BACKEND_SERVICE
                && marker.instance_token == instance_token
        });
    if owned {
        let _ = std::fs::remove_file(path);
    }
}

fn backend_log_path() -> PathBuf {
    vector_data_dir().join("logs/python-core.log")
}

#[cfg(target_os = "windows")]
fn process_is_running(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    let mut command = std::process::Command::new("tasklist.exe");
    command
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(0x08000000);
    command.output().ok().is_some_and(|output| {
        String::from_utf8_lossy(&output.stdout).lines().any(|line| {
            line.split(',')
                .nth(1)
                .map(|value| value.trim().trim_matches('"') == pid.to_string())
                .unwrap_or(false)
        })
    })
}

#[cfg(not(target_os = "windows"))]
fn process_is_running(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn stop_registered_orphan(health: &BackendHealth) -> Result<bool, String> {
    let marker_path = backend_marker_path();
    let marker = match std::fs::read_to_string(&marker_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<BackendOwnerMarker>(&raw).ok())
    {
        Some(marker) => marker,
        None => return Ok(false),
    };
    if !marker.managed_by_app
        || marker.service != BACKEND_SERVICE
        || marker.instance_token.is_empty()
        || marker.instance_token != health.instance_token
        || marker.pid == 0
        || marker.pid != health.pid
        || marker.parent_pid != health.parent_pid
    {
        return Ok(false);
    }
    if marker.parent_pid != 0 && process_is_running(marker.parent_pid) {
        return Err(
            "Một cửa sổ VECTOR AI khác đang quản lý Python Core ở cổng 8000. Hãy chỉ chạy một cửa sổ ứng dụng."
                .into(),
        );
    }
    #[cfg(target_os = "windows")]
    {
        let mut command = std::process::Command::new("taskkill.exe");
        let status = command
            .args(["/PID", &marker.pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x08000000)
            .status()
            .map_err(|error| format!("Không thể dừng Python Core cũ: {error}"))?;
        if !status.success() && process_is_running(marker.pid) {
            return Err("Không thể dừng Python Core cũ do VECTOR AI quản lý.".into());
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let status = std::process::Command::new("kill")
            .args(["-TERM", &marker.pid.to_string()])
            .status()
            .map_err(|error| format!("Không thể dừng Python Core cũ: {error}"))?;
        if !status.success() && process_is_running(marker.pid) {
            return Err("Không thể dừng Python Core cũ do VECTOR AI quản lý.".into());
        }
    }
    let _ = std::fs::remove_file(marker_path);
    Ok(true)
}

fn backend_log_tail(path: &Path) -> String {
    let Ok(mut file) = File::open(path) else {
        return String::new();
    };
    let length = file.metadata().map(|value| value.len()).unwrap_or(0);
    let start = length.saturating_sub(4096);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return String::new();
    }
    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() {
        return String::new();
    }
    String::from_utf8_lossy(&bytes).trim().to_string()
}

#[tauri::command]
async fn ensure_backend(state: State<'_, BackendState>) -> Result<(), String> {
    match backend_health().await {
        Ok(Some(health)) if backend_health_matches(&health, None) => return Ok(()),
        Ok(Some(health)) => {
            if !stop_registered_orphan(&health)? {
                return Err(format!(
                    "Cổng 127.0.0.1:8000 đang chạy backend cũ hoặc dịch vụ khác (service='{}', protocol={}, build='{}'). VECTOR AI sẽ không tự dừng tiến trình không xác minh được. Hãy đóng tiến trình cũ rồi mở lại app.",
                    health.service, health.protocol_version, health.build_id
                ));
            }
            for _ in 0..20 {
                if !backend_port_is_open() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            if backend_port_is_open() {
                return Err(
                    "Python Core cũ chưa nhả cổng 8000. Hãy đóng VECTOR AI rồi thử lại.".into(),
                );
            }
        }
        Ok(None) => {}
        Err(error) => return Err(error),
    }
    let project = project_root();
    let backend_dir = project.join("backend");
    if !backend_dir.join("vector_ai_backend").is_dir() {
        return Err("Không tìm thấy Python Core trong thư mục dự án.".into());
    }
    let venv_python = backend_dir.join(".venv/Scripts/python.exe");
    let runtime = runtime_bundle_at(&project);
    let portable_python = runtime.as_ref().map(|path| path.join("python/python.exe"));
    let python = if let Some(path) = portable_python.filter(|path| path.is_file()) {
        path
    } else if venv_python.is_file() {
        venv_python
    } else {
        PathBuf::from("python.exe")
    };
    let existing_token = {
        let mut guard = state
            .0
            .lock()
            .map_err(|_| "Không thể khóa trạng thái backend")?;
        if let Some(process) = guard.as_mut() {
            if process.child.try_wait().ok().flatten().is_none() {
                Some(process.instance_token.clone())
            } else {
                *guard = None;
                None
            }
        } else {
            None
        }
    };
    if let Some(token) = existing_token {
        for _ in 0..50 {
            if let Ok(Some(health)) = backend_health().await {
                if backend_health_matches(&health, Some(&token)) {
                    return Ok(());
                }
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        return Err("Python Core đang chạy nhưng không hoàn tất bắt tay phiên bản.".into());
    }

    let log_path = backend_log_path();
    std::fs::create_dir_all(log_path.parent().unwrap_or_else(|| Path::new(".")))
        .map_err(|error| format!("Không thể tạo thư mục log Python Core: {error}"))?;
    let stdout_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| format!("Không thể mở log Python Core: {error}"))?;
    let stderr_log = stdout_log
        .try_clone()
        .map_err(|error| format!("Không thể mở stderr Python Core: {error}"))?;
    let instance_token = uuid::Uuid::new_v4().to_string();
    {
        let mut guard = state
            .0
            .lock()
            .map_err(|_| "Không thể khóa trạng thái backend")?;
        let mut command = std::process::Command::new(python);
        command
            .args(["-m", "vector_ai_backend"])
            .current_dir(&backend_dir)
            .env("PYTHONUTF8", "1")
            .env("PYTHONNOUSERSITE", "1")
            .env("VECTOR_AI_INSTANCE_TOKEN", &instance_token)
            .env("VECTOR_AI_PARENT_PID", std::process::id().to_string())
            .env("VECTOR_AI_CORE_BUILD_ID", BACKEND_BUILD_ID)
            .stdin(Stdio::null())
            .stdout(Stdio::from(stdout_log))
            .stderr(Stdio::from(stderr_log));
        if let Some(path) = &runtime {
            let qdrant = path.join("qdrant/qdrant.exe");
            if qdrant.is_file() {
                command.env("VECTOR_AI_QDRANT_EXE", qdrant);
            }
        }
        #[cfg(target_os = "windows")]
        command.creation_flags(0x08000000);
        let child = command
            .spawn()
            .map_err(|error| format!("Không thể khởi động Python Core: {error}"))?;
        *guard = Some(BackendProcess {
            child,
            instance_token: instance_token.clone(),
        });
    }
    for _ in 0..50 {
        match backend_health().await {
            Ok(Some(health)) if backend_health_matches(&health, Some(&instance_token)) => {
                return Ok(())
            }
            Ok(Some(health))
                if !health.instance_token.is_empty() && health.instance_token != instance_token =>
            {
                return Err("Một Python Core khác đã chiếm cổng 8000 trong lúc khởi động.".into())
            }
            _ => {}
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    let tail = backend_log_tail(&log_path);
    Err(if tail.is_empty() {
        format!(
            "Python Core chưa sẵn sàng tại 127.0.0.1:8000. Xem log: {}",
            log_path.display()
        )
    } else {
        format!(
            "Python Core không khởi động được. Log: {}\n{}",
            log_path.display(),
            tail
        )
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamEvent {
    request_id: String,
    kind: String,
    content: String,
    eval_count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaStatus {
    running: bool,
    installed: bool,
    model_ready: bool,
    model: String,
    error: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmbedRequest {
    inputs: Vec<String>,
    #[serde(default)]
    model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelInfo {
    name: String,
    size: u64,
    parameter_size: String,
    quantization: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledBackupModel {
    model: String,
    source_file: String,
    size: u64,
}

fn emit_backup_install(app: &AppHandle, stage: &str, message: &str, percent: u64) {
    app.emit(
        "model-backup-install",
        json!({
            "stage": stage,
            "message": message,
            "percent": percent.min(100)
        }),
    )
    .ok();
}

fn valid_ollama_model_name(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.len() <= 120
        && !matches!(value.chars().next(), Some('.' | '-' | '/' | ':'))
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/' | ':'))
}

fn canonical_ollama_model_name(value: &str) -> String {
    let value = value.trim();
    let leaf = value.rsplit('/').next().unwrap_or_default();
    if leaf.contains(':') {
        value.to_string()
    } else {
        format!("{value}:latest")
    }
}

fn same_ollama_model_name(left: &str, right: &str) -> bool {
    canonical_ollama_model_name(left) == canonical_ollama_model_name(right)
}

fn locate_gguf_in_backup(backup_path: &Path) -> Result<(usize, String, u64), String> {
    let file =
        File::open(backup_path).map_err(|error| format!("Không thể mở backup.zip: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("File ZIP không hợp lệ: {error}"))?;
    let mut preferred_name = None;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Không thể đọc ZIP: {error}"))?;
        let normalized = entry.name().replace('\\', "/");
        if normalized.eq_ignore_ascii_case("training_summary.json")
            && entry.size() <= 2 * 1024 * 1024
        {
            let mut summary = String::new();
            if entry.read_to_string(&mut summary).is_ok() {
                preferred_name = serde_json::from_str::<Value>(&summary)
                    .ok()
                    .and_then(|value| value["final_model"].as_str().map(str::to_string));
            }
            break;
        }
    }

    let mut candidates = Vec::new();
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("Không thể đọc ZIP: {error}"))?;
        let normalized = entry.name().replace('\\', "/");
        let lowered = normalized.to_ascii_lowercase();
        if !entry.is_dir() && lowered.ends_with(".gguf") && !lowered.contains("mmproj") {
            candidates.push((index, normalized, entry.size()));
        }
    }
    if candidates.is_empty() {
        return Err(
            "Backup không chứa model GGUF. Hãy dùng backup.zip được tạo ở CELL 3 của notebook."
                .into(),
        );
    }
    if candidates.len() > 8 {
        return Err("Backup chứa quá nhiều file GGUF nên không thể xác định model chính.".into());
    }

    let selected = preferred_name
        .as_deref()
        .and_then(|preferred| {
            candidates.iter().find(|(_, name, _)| {
                name.eq_ignore_ascii_case(preferred)
                    || Path::new(name)
                        .file_name()
                        .and_then(|value| value.to_str())
                        .map(|value| value.eq_ignore_ascii_case(preferred))
                        .unwrap_or(false)
            })
        })
        .or_else(|| candidates.iter().max_by_key(|(_, _, size)| *size))
        .cloned()
        .ok_or_else(|| "Không thể xác định model GGUF trong backup.".to_string())?;

    if selected.2 < 1024 * 1024 {
        return Err("File GGUF trong backup nhỏ bất thường và có thể đã bị hỏng.".into());
    }
    if selected.2 > 32 * 1024 * 1024 * 1024_u64 {
        return Err("Model GGUF vượt giới hạn an toàn 32 GB.".into());
    }
    Ok(selected)
}

fn extract_and_validate_gguf(
    app: &AppHandle,
    backup_path: &Path,
    entry_index: usize,
    output_path: &Path,
    expected_size: u64,
) -> Result<(), String> {
    let file =
        File::open(backup_path).map_err(|error| format!("Không thể mở backup.zip: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("File ZIP không hợp lệ: {error}"))?;
    let mut entry = archive
        .by_index(entry_index)
        .map_err(|error| format!("Không thể đọc model trong ZIP: {error}"))?;
    let mut output = File::create(output_path)
        .map_err(|error| format!("Không thể tạo file model tạm: {error}"))?;
    let mut buffer = vec![0_u8; 8 * 1024 * 1024];
    let mut copied = 0_u64;
    let mut last_percent = 0_u64;
    loop {
        let count = entry
            .read(&mut buffer)
            .map_err(|error| format!("Backup bị lỗi khi đọc model: {error}"))?;
        if count == 0 {
            break;
        }
        output
            .write_all(&buffer[..count])
            .map_err(|error| format!("Không đủ dung lượng để giải nén model: {error}"))?;
        copied = copied.saturating_add(count as u64);
        let percent = if expected_size > 0 {
            8 + copied.saturating_mul(57) / expected_size
        } else {
            8
        };
        if percent != last_percent {
            emit_backup_install(
                app,
                "extracting",
                &format!(
                    "Đang giải nén và kiểm tra model… {}%",
                    ((copied as f64 / expected_size.max(1) as f64) * 100.0).round() as u64
                ),
                percent,
            );
            last_percent = percent;
        }
    }
    output
        .flush()
        .map_err(|error| format!("Không thể hoàn tất file model tạm: {error}"))?;
    drop(output);

    if copied != expected_size {
        return Err(format!(
            "Model giải nén không đủ dữ liệu: nhận {copied} byte, cần {expected_size} byte."
        ));
    }
    let mut model =
        File::open(output_path).map_err(|error| format!("Không thể kiểm tra GGUF: {error}"))?;
    let mut magic = [0_u8; 4];
    model
        .read_exact(&mut magic)
        .map_err(|error| format!("Không thể đọc tiêu đề GGUF: {error}"))?;
    if &magic != b"GGUF" {
        return Err("File model không có chữ ký GGUF hợp lệ.".into());
    }
    Ok(())
}

#[tauri::command]
async fn list_models() -> Result<Vec<ModelInfo>, String> {
    let response = client()?
        .get(format!("{OLLAMA_URL}/api/tags"))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Ollama HTTP {}", response.status()));
    }
    let body = response
        .json::<Value>()
        .await
        .map_err(|error| error.to_string())?;
    Ok(body["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            Some(ModelInfo {
                name: item["name"].as_str()?.to_string(),
                size: item["size"].as_u64().unwrap_or(0),
                parameter_size: item["details"]["parameter_size"]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
                quantization: item["details"]["quantization_level"]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
            })
        })
        .collect())
}

#[tauri::command]
async fn delete_model(model: String) -> Result<(), String> {
    let requested_model = model.trim();
    if requested_model.is_empty()
        || requested_model.len() > 180
        || requested_model
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return Err("Tên model Ollama không hợp lệ".into());
    }

    let http = client()?;
    let tags_response = http
        .get(format!("{OLLAMA_URL}/api/tags"))
        .send()
        .await
        .map_err(|error| format!("Không thể đọc thư viện Ollama: {error}"))?;
    if !tags_response.status().is_success() {
        return Err(format!("Ollama HTTP {}", tags_response.status()));
    }
    let tags = tags_response
        .json::<Value>()
        .await
        .map_err(|error| format!("Ollama trả về danh sách model không hợp lệ: {error}"))?;
    let exact_model = tags["models"]
        .as_array()
        .into_iter()
        .flatten()
        .find_map(|item| {
            let name = item["name"].as_str().or_else(|| item["model"].as_str())?;
            same_ollama_model_name(name, requested_model).then(|| name.to_string())
        })
        .ok_or_else(|| "Model không còn tồn tại trong thư viện Ollama".to_string())?;

    let is_loaded = match http.get(format!("{OLLAMA_URL}/api/ps")).send().await {
        Ok(response) if response.status().is_success() => response
            .json::<Value>()
            .await
            .ok()
            .and_then(|body| body["models"].as_array().cloned())
            .map(|models| {
                models.iter().any(|item| {
                    item["name"]
                        .as_str()
                        .or_else(|| item["model"].as_str())
                        .map(|name| same_ollama_model_name(name, &exact_model))
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false),
        _ => false,
    };
    if is_loaded {
        let _ = http
            .post(format!("{OLLAMA_URL}/api/generate"))
            .json(&json!({
                "model": exact_model,
                "stream": false,
                "keep_alive": 0
            }))
            .send()
            .await;
    }

    let response = http
        .delete(format!("{OLLAMA_URL}/api/delete"))
        .json(&json!({ "model": exact_model }))
        .send()
        .await
        .map_err(|error| format!("Không thể kết nối Ollama để xóa model: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(if detail.trim().is_empty() {
            format!("Ollama HTTP {status}")
        } else {
            format!("Ollama HTTP {status}: {}", detail.trim())
        });
    }
    Ok(())
}

#[tauri::command]
async fn install_model_backup(
    app: AppHandle,
    requested_name: String,
) -> Result<Option<InstalledBackupModel>, String> {
    if !ollama_installed() {
        return Err("Chưa cài Ollama. Hãy cài hoặc khởi động Ollama trước.".into());
    }
    let model_name = if requested_name.trim().is_empty() {
        "vector-ai-finetuned".to_string()
    } else {
        requested_name.trim().to_string()
    };
    if !valid_ollama_model_name(&model_name) {
        return Err(
            "Tên model chỉ được chứa chữ, số, dấu chấm, gạch ngang, gạch dưới, / hoặc :.".into(),
        );
    }

    let backup_path = tokio::task::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Chọn backup.zip chứa model GGUF")
            .add_filter("Backup model", &["zip"])
            .pick_file()
    })
    .await
    .map_err(|error| format!("Không thể mở hộp chọn file: {error}"))?;
    let Some(backup_path) = backup_path else {
        return Ok(None);
    };
    if !backup_path.is_file() {
        return Err("File backup đã chọn không còn tồn tại.".into());
    }
    if backup_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| !value.eq_ignore_ascii_case("zip"))
        .unwrap_or(true)
    {
        return Err("Chỉ chấp nhận file backup có đuôi .zip.".into());
    }

    emit_backup_install(&app, "inspecting", "Đang kiểm tra cấu trúc backup.zip…", 3);
    let inspect_path = backup_path.clone();
    let (entry_index, source_file, model_size) =
        tokio::task::spawn_blocking(move || locate_gguf_in_backup(&inspect_path))
            .await
            .map_err(|error| format!("Không thể kiểm tra backup: {error}"))??;

    emit_backup_install(
        &app,
        "validated",
        &format!(
            "Đã tìm thấy {source_file} · {:.2} GB",
            model_size as f64 / 1024_f64.powi(3)
        ),
        7,
    );
    let temporary = tempfile::Builder::new()
        .prefix("vector-ai-model-import-")
        .tempdir()
        .map_err(|error| format!("Không thể tạo thư mục tạm: {error}"))?;
    let extracted_model = temporary.path().join("model.gguf");
    let extract_app = app.clone();
    let extract_backup = backup_path.clone();
    let extract_target = extracted_model.clone();
    tokio::task::spawn_blocking(move || {
        extract_and_validate_gguf(
            &extract_app,
            &extract_backup,
            entry_index,
            &extract_target,
            model_size,
        )
    })
    .await
    .map_err(|error| format!("Tiến trình giải nén bị dừng: {error}"))??;

    emit_backup_install(
        &app,
        "validated",
        "GGUF hợp lệ. Đang chuẩn bị Modelfile…",
        68,
    );
    let modelfile = temporary.path().join("Modelfile");
    std::fs::write(
        &modelfile,
        "FROM ./model.gguf\n\nPARAMETER num_ctx 8192\nPARAMETER temperature 0.7\nPARAMETER top_p 0.8\nPARAMETER top_k 20\n",
    )
    .map_err(|error| format!("Không thể tạo Modelfile: {error}"))?;

    emit_backup_install(
        &app,
        "registering",
        "Ollama đang nhập model vào thư viện cục bộ…",
        72,
    );
    let executable = ollama_paths()
        .into_iter()
        .find(|path| path.is_file())
        .unwrap_or_else(|| PathBuf::from("ollama.exe"));
    let output = tokio::process::Command::new(&executable)
        .args(["create", model_name.as_str(), "-f", "Modelfile"])
        .current_dir(temporary.path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|error| format!("Không thể chạy ollama create: {error}"))?;
    if !output.status.success() {
        let combined = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let detail: String = combined
            .chars()
            .rev()
            .take(4000)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        return Err(format!(
            "Ollama không thể cài model ({}).\n{}",
            output.status,
            detail.trim()
        ));
    }

    emit_backup_install(&app, "verifying", "Đang xác minh model trong Ollama…", 96);
    let verified = tokio::process::Command::new(&executable)
        .args(["show", model_name.as_str()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|error| format!("Không thể xác minh model: {error}"))?;
    if !verified.success() {
        return Err("Ollama đã nhập dữ liệu nhưng không thể xác minh model vừa tạo.".into());
    }

    emit_backup_install(&app, "done", "Cài model thành công.", 100);
    Ok(Some(InstalledBackupModel {
        model: model_name,
        source_file,
        size: model_size,
    }))
}

#[tauri::command]
async fn embed_texts(request: EmbedRequest) -> Result<Vec<Vec<f32>>, String> {
    if request.inputs.is_empty() {
        return Ok(Vec::new());
    }
    if request.inputs.len() > 32 {
        return Err("Mỗi lần chỉ tạo tối đa 32 embedding".into());
    }
    let response = client()?
        .post(format!("{OLLAMA_URL}/api/embed"))
        .json(&json!({
            "model": if request.model.trim().is_empty() { MODEL } else { request.model.trim() },
            "input": request.inputs,
            "truncate": true,
            "keep_alive": "2m"
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(format!("Ollama embedding HTTP {status}: {detail}"));
    }
    let body = response
        .json::<Value>()
        .await
        .map_err(|error| error.to_string())?;
    serde_json::from_value(body["embeddings"].clone())
        .map_err(|error| format!("Dữ liệu embedding không hợp lệ: {error}"))
}

fn ollama_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(runtime) = runtime_bundle_at(&project_root()) {
        paths.push(runtime.join("ollama/ollama.exe"));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        paths.push(PathBuf::from(local).join("Programs/Ollama/ollama.exe"));
    }
    paths.push(PathBuf::from("ollama.exe"));
    paths
}

fn resolve_ollama_executable() -> Option<PathBuf> {
    if let Some(path) = ollama_paths().into_iter().find(|path| path.is_file()) {
        return Some(path);
    }
    std::process::Command::new("where")
        .args(["ollama.exe"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()
        .filter(|status| status.success())
        .map(|_| PathBuf::from("ollama.exe"))
}

fn ollama_installed() -> bool {
    resolve_ollama_executable().is_some()
}

async fn ollama_api_ready() -> bool {
    let http = match reqwest::Client::builder()
        .connect_timeout(Duration::from_millis(500))
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(http) => http,
        Err(_) => return false,
    };
    match http.get(format!("{OLLAMA_URL}/api/tags")).send().await {
        Ok(response) if response.status().is_success() => response
            .json::<Value>()
            .await
            .ok()
            .and_then(|body| body["models"].as_array().map(|_| ()))
            .is_some(),
        _ => false,
    }
}

fn client() -> Result<reqwest::Client, String> {
    static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(http) = HTTP_CLIENT.get() {
        return Ok(http.clone());
    }
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(1800))
        .build()
        .map_err(|error| error.to_string())?;
    // Clones share the connection pool; a failed build remains retryable.
    Ok(HTTP_CLIENT.get_or_init(|| http).clone())
}

async fn unload_other_models(http: &reqwest::Client, selected_model: &str) {
    let loaded = match http.get(format!("{OLLAMA_URL}/api/ps")).send().await {
        Ok(response) if response.status().is_success() => response
            .json::<Value>()
            .await
            .ok()
            .and_then(|body| body["models"].as_array().cloned())
            .unwrap_or_default(),
        _ => return,
    };
    for item in loaded {
        let Some(model) = item["name"]
            .as_str()
            .or_else(|| item["model"].as_str())
            .map(str::to_string)
        else {
            continue;
        };
        if same_ollama_model_name(&model, selected_model) {
            continue;
        }
        let _ = http
            .post(format!("{OLLAMA_URL}/api/generate"))
            .json(&json!({ "model": model, "stream": false, "keep_alive": 0 }))
            .send()
            .await;
    }
}

#[tauri::command]
async fn ollama_status(model: Option<String>) -> OllamaStatus {
    let requested_model = model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(MODEL)
        .to_string();
    let installed = ollama_installed();
    let mut result = OllamaStatus {
        running: false,
        installed,
        model_ready: false,
        model: requested_model.clone(),
        error: String::new(),
    };
    let http = match client() {
        Ok(value) => value,
        Err(error) => {
            result.error = error;
            return result;
        }
    };
    match http.get(format!("{OLLAMA_URL}/api/tags")).send().await {
        Ok(response) if response.status().is_success() => {
            result.running = true;
            match response.json::<Value>().await {
                Ok(body) => {
                    result.model_ready = body["models"]
                        .as_array()
                        .map(|models| {
                            models.iter().any(|item| {
                                item["name"]
                                    .as_str()
                                    .or_else(|| item["model"].as_str())
                                    .map(|name| same_ollama_model_name(name, &requested_model))
                                    .unwrap_or(false)
                            })
                        })
                        .unwrap_or(false);
                }
                Err(error) => result.error = error.to_string(),
            }
        }
        Ok(response) => result.error = format!("Ollama HTTP {}", response.status()),
        Err(error) => result.error = error.to_string(),
    }
    result
}

#[tauri::command]
async fn start_ollama(state: State<'_, OllamaState>) -> Result<(), String> {
    if ollama_api_ready().await {
        return Ok(());
    }
    let executable = resolve_ollama_executable()
        .ok_or_else(|| "Không tìm thấy Ollama trên máy. Hãy cài Ollama trước.".to_string())?;
    let mut command = std::process::Command::new(&executable);
    command
        .arg("serve")
        .env("OLLAMA_HOST", "127.0.0.1:11434")
        .env("OLLAMA_MAX_LOADED_MODELS", "1")
        .env("OLLAMA_NUM_PARALLEL", "1")
        .env("OLLAMA_KEEP_ALIVE", "30m")
        .env("OLLAMA_FLASH_ATTENTION", "1")
        .env("OLLAMA_KV_CACHE_TYPE", "q8_0")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let portable_models = project_root().join("runtime/models/ollama");
    if std::env::var_os("OLLAMA_MODELS").is_none() && portable_models.join("manifests").is_dir() {
        command.env("OLLAMA_MODELS", portable_models);
    }
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);

    let mut process = command.spawn().map_err(|error| {
        format!(
            "Không thể khởi động Ollama từ {}: {error}",
            executable.display()
        )
    })?;

    for _ in 0..60 {
        if ollama_api_ready().await {
            let mut guard = state
                .0
                .lock()
                .map_err(|_| "Không thể ghi nhận tiến trình Ollama do VECTOR AI quản lý")?;
            *guard = Some(process);
            return Ok(());
        }
        if let Some(status) = process
            .try_wait()
            .map_err(|error| format!("Không thể kiểm tra tiến trình Ollama: {error}"))?
        {
            return Err(format!(
                "Ollama đã dừng trước khi cổng 127.0.0.1:11434 sẵn sàng (mã: {status})."
            ));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    let _ = process.kill();
    let _ = process.wait();
    Err("Ollama đã được mở nhưng không sẵn sàng tại 127.0.0.1:11434 sau 15 giây.".into())
}

#[tauri::command]
async fn install_ollama(app: AppHandle) -> Result<(), String> {
    if ollama_installed() {
        return Ok(());
    }
    let script = r#"
$ErrorActionPreference = 'Stop'
$url = 'https://ollama.com/download/OllamaSetup.exe'
$target = Join-Path $env:TEMP 'VECTOR-AI-OllamaSetup.exe'
Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing
Start-Process -FilePath $target -Wait
"#;
    app.emit(
        "setup-event",
        json!({"kind":"status", "message":"Đang tải bộ cài Ollama chính thức..."}),
    )
    .ok();
    let status = tokio::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .status()
        .await
        .map_err(|error| error.to_string())?;
    if status.success() {
        app.emit(
            "setup-event",
            json!({"kind":"done", "message":"Ollama đã được cài đặt."}),
        )
        .ok();
        Ok(())
    } else {
        Err(format!("Bộ cài Ollama kết thúc với mã {status}"))
    }
}

#[tauri::command]
async fn pull_model(app: AppHandle) -> Result<(), String> {
    pull_named(app, MODEL.to_string()).await
}

async fn pull_named(app: AppHandle, model: String) -> Result<(), String> {
    let model = model.trim().to_string();
    if model.is_empty()
        || model.len() > 180
        || model.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("Tên model Ollama không hợp lệ".into());
    }
    let http = client()?;
    let response = http
        .post(format!("{OLLAMA_URL}/api/pull"))
        .json(&json!({"model": model, "stream": true}))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(if detail.trim().is_empty() {
            format!("Ollama HTTP {status}")
        } else {
            format!("Ollama HTTP {status}: {detail}")
        });
    }
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(index) = buffer.find('\n') {
            let line = buffer[..index].trim().to_string();
            buffer.drain(..=index);
            if line.is_empty() {
                continue;
            }
            if let Ok(data) = serde_json::from_str::<Value>(&line) {
                let total = data["total"].as_u64().unwrap_or(0);
                let completed = data["completed"].as_u64().unwrap_or(0);
                let percent = if total > 0 {
                    completed.saturating_mul(100) / total
                } else {
                    0
                };
                app.emit(
                    "model-pull",
                    json!({
                        "status": data["status"].as_str().unwrap_or("Đang tải"),
                        "total": total,
                        "completed": completed,
                        "percent": percent
                    }),
                )
                .ok();
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn pull_named_model(app: AppHandle, model: String) -> Result<(), String> {
    pull_named(app, model).await
}

fn is_cancelled(state: &CancelState, request_id: &str) -> bool {
    state
        .0
        .lock()
        .map(|items| items.contains(request_id))
        .unwrap_or(false)
}

#[tauri::command]
fn cancel_chat(request_id: String, state: State<'_, CancelState>) {
    if let Ok(mut items) = state.0.lock() {
        items.insert(request_id);
    }
}

fn emit_chat_line(app: &AppHandle, request_id: &str, line: &str) -> Result<(), String> {
    if line.trim().is_empty() {
        return Ok(());
    }
    let data: Value = serde_json::from_str(line).map_err(|error| error.to_string())?;
    if let Some(error) = data["error"].as_str() {
        return Err(error.to_string());
    }
    if let Some(delta) = data["message"]["content"].as_str() {
        if !delta.is_empty() {
            app.emit(
                "chat-stream",
                StreamEvent {
                    request_id: request_id.to_string(),
                    kind: "delta".into(),
                    content: delta.to_string(),
                    eval_count: 0,
                },
            )
            .ok();
        }
    }
    if data["done"].as_bool().unwrap_or(false) {
        let eval_count = data["eval_count"].as_u64().unwrap_or(0);
        if data["done_reason"].as_str().unwrap_or("") == "length" {
            app.emit(
                "chat-stream",
                StreamEvent {
                    request_id: request_id.to_string(),
                    kind: "truncated".into(),
                    content: String::new(),
                    eval_count,
                },
            )
            .ok();
        }
        app.emit(
            "chat-stream",
            StreamEvent {
                request_id: request_id.to_string(),
                kind: "done".into(),
                content: String::new(),
                eval_count,
            },
        )
        .ok();
    }
    Ok(())
}

fn build_ollama_messages(items: &[ChatMessage]) -> Vec<Value> {
    let mut system_parts = vec![SYSTEM_PROMPT.to_string()];
    system_parts.extend(
        items
            .iter()
            .filter(|item| item.role.eq_ignore_ascii_case("system"))
            .map(|item| item.content.trim())
            .filter(|content| !content.is_empty())
            .map(str::to_string),
    );
    let mut messages = vec![json!({
        "role": "system",
        "content": system_parts.join("\n\n")
    })];
    messages.extend(
        items
            .iter()
            .filter(|item| !item.role.eq_ignore_ascii_case("system"))
            .map(|item| {
                if item.images.is_empty() {
                    json!({"role": item.role, "content": item.content})
                } else {
                    json!({"role": item.role, "content": item.content, "images": item.images})
                }
            }),
    );
    messages
}

#[cfg(debug_assertions)]
fn wait_for_dev_frontend() -> Result<(), String> {
    let address = "127.0.0.1:3000"
        .parse()
        .map_err(|error| format!("Địa chỉ frontend không hợp lệ: {error}"))?;
    for _ in 0..200 {
        if std::net::TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(
        "Frontend phát triển chưa mở được 127.0.0.1:3000 sau 20 giây. Hãy chạy lại F5 hoặc RUN_VECTOR_AI.bat và giữ terminal phát triển đang mở."
            .into(),
    )
}

#[tauri::command]
async fn chat(
    app: AppHandle,
    request: ChatRequest,
    state: State<'_, CancelState>,
) -> Result<(), String> {
    if let Ok(mut items) = state.0.lock() {
        items.remove(&request.request_id);
    }
    let request_id = request.request_id.clone();
    let selected_model = if request.model.trim().is_empty() {
        MODEL
    } else {
        request.model.trim()
    };
    let messages = build_ollama_messages(&request.messages);
    let http = client()?;
    // Máy 6 GB VRAM chỉ nên giữ một model sinh văn bản. Dỡ model khác trước
    // khi nạp model được người dùng chọn trong Ollama.
    unload_other_models(&http, selected_model).await;
    let mode = request.mode.trim().to_ascii_uppercase();
    let deep = mode == "DEEP" || (mode.is_empty() && request.reasoning);
    let normal = mode == "NORMAL";
    let response = http
        .post(format!("{OLLAMA_URL}/api/chat"))
        .json(&json!({
            "model": selected_model,
            "messages": messages,
            "stream": true,
            // Qwen has no bounded thinking level. NORMAL keeps its 4K answer
            // budget but leaves hidden thinking off; DEEP is the explicit
            // opt-in mode for full reasoning.
            "think": deep,
            "keep_alive": "30m",
            "options": {
                "temperature": 0.1,
                "top_p": 0.9,
                // -1 yêu cầu Ollama offload nhiều lớp nhất có thể mà vẫn vừa VRAM.
                "num_gpu": -1,
                "main_gpu": 0,
                "num_ctx": if deep { 16384 } else { 8192 },
                "num_predict": if deep { 8192 } else if normal { 4096 } else { 2048 },
                "repeat_penalty": 1.1
            }
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(if detail.trim().is_empty() {
            format!("Ollama HTTP {status}")
        } else {
            format!("Ollama HTTP {status}: {detail}")
        });
    }
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    while let Some(chunk) = stream.next().await {
        if is_cancelled(&state, &request_id) {
            app.emit(
                "chat-stream",
                StreamEvent {
                    request_id: request_id.clone(),
                    kind: "cancelled".into(),
                    content: String::new(),
                    eval_count: 0,
                },
            )
            .ok();
            return Ok(());
        }
        let chunk = chunk.map_err(|error| error.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(index) = buffer.find('\n') {
            let line = buffer[..index].trim().to_string();
            buffer.drain(..=index);
            if line.is_empty() {
                continue;
            }
            emit_chat_line(&app, &request_id, &line)?;
        }
    }
    if !buffer.trim().is_empty() {
        emit_chat_line(&app, &request_id, buffer.trim())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    if let Err(error) = wait_for_dev_frontend() {
        eprintln!("{error}");
        rfd::MessageDialog::new()
            .set_title("Không thể mở VECTOR AI")
            .set_description(&error)
            .set_level(rfd::MessageLevel::Error)
            .show();
        return;
    }
    let application = tauri::Builder::default()
        .manage(CancelState(Mutex::new(HashSet::new())))
        .manage(BackendState(Mutex::new(None)))
        .manage(OllamaState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            ensure_backend,
            ollama_status,
            start_ollama,
            install_ollama,
            pull_model,
            pull_named_model,
            install_model_backup,
            list_models,
            delete_model,
            embed_texts,
            chat,
            cancel_chat
        ])
        .build(tauri::generate_context!())
        .expect("error while building VECTOR AI");
    application.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Ok(mut guard) = app.state::<BackendState>().0.lock() {
                if let Some(process) = guard.as_mut() {
                    let _ = process.child.kill();
                    let _ = process.child.wait();
                    remove_backend_marker_if_owned(&process.instance_token);
                }
                *guard = None;
            }
            if let Ok(mut guard) = app.state::<OllamaState>().0.lock() {
                if let Some(process) = guard.as_mut() {
                    let _ = process.kill();
                    let _ = process.wait();
                }
                *guard = None;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_health_requires_current_contract_and_optional_token() {
        let current = BackendHealth {
            status: "ready".into(),
            service: BACKEND_SERVICE.into(),
            protocol_version: BACKEND_PROTOCOL_VERSION,
            build_id: BACKEND_BUILD_ID.into(),
            instance_token: "owned-token".into(),
            pid: 10,
            parent_pid: 20,
        };
        assert!(backend_health_matches(&current, None));
        assert!(backend_health_matches(&current, Some("owned-token")));
        assert!(!backend_health_matches(&current, Some("another-token")));
        let mut stale = current.clone();
        stale.build_id = "old-build".into();
        assert!(!backend_health_matches(&stale, None));
    }

    #[test]
    fn ollama_messages_have_exactly_one_initial_system_message() {
        let messages = build_ollama_messages(&[
            ChatMessage {
                role: "user".into(),
                content: "Câu đầu".into(),
                images: vec![],
            },
            ChatMessage {
                role: "system".into(),
                content: "Nguồn RAG".into(),
                images: vec![],
            },
            ChatMessage {
                role: "assistant".into(),
                content: "Trả lời".into(),
                images: vec![],
            },
            ChatMessage {
                role: "system".into(),
                content: "Quy tắc thêm".into(),
                images: vec![],
            },
        ]);
        assert_eq!(messages[0]["role"], "system");
        assert!(messages[0]["content"]
            .as_str()
            .unwrap()
            .contains("Nguồn RAG"));
        assert!(messages[0]["content"]
            .as_str()
            .unwrap()
            .contains("Quy tắc thêm"));
        assert_eq!(
            messages
                .iter()
                .filter(|item| item["role"] == "system")
                .count(),
            1
        );
        assert_eq!(messages[1]["role"], "user");
        assert_eq!(messages[2]["role"], "assistant");
    }
}
