use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{ipc::InvokeBody, AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;

#[cfg(target_os = "macos")]
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const PROGRESS_EVENT: &str = "native-asr-progress";

#[derive(Default)]
pub struct NativeAsrState {
    tasks: Mutex<HashMap<String, Arc<AtomicBool>>>,
    audio_inputs: Mutex<HashMap<String, Vec<f32>>>,
}

#[derive(Clone, Copy)]
struct ModelSpec {
    file_name: &'static str,
    url: &'static str,
    minimum_size: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    task_id: String,
    progress: u8,
    message: String,
}

#[derive(Serialize)]
pub struct NativeAsrCapabilities {
    available: bool,
    backend: &'static str,
}

#[derive(Serialize)]
pub struct NativeAsrSegment {
    text: String,
    timestamp: [f64; 2],
}

#[derive(Serialize)]
pub struct NativeAsrResult {
    text: String,
    chunks: Vec<NativeAsrSegment>,
}

fn model_spec(model_id: &str) -> Result<ModelSpec, String> {
    match model_id {
        "onnx-community/whisper-large-v3-turbo" => Ok(ModelSpec {
            file_name: "ggml-large-v3-turbo-q5_0.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
            minimum_size: 570_000_000,
        }),
        "Xenova/whisper-small" => Ok(ModelSpec {
            file_name: "ggml-small-q5_1.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin",
            minimum_size: 188_000_000,
        }),
        _ => Err("不支持的本地转写模型".to_string()),
    }
}

fn model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("models").join("whisper.cpp"))
        .map_err(|error| format!("无法定位模型目录：{error}"))
}

fn model_path(app: &AppHandle, model_id: &str) -> Result<PathBuf, String> {
    Ok(model_dir(app)?.join(model_spec(model_id)?.file_name))
}

fn emit_progress(app: &AppHandle, task_id: &str, progress: u8, message: impl Into<String>) {
    let _ = app.emit(
        PROGRESS_EVENT,
        ProgressEvent {
            task_id: task_id.to_string(),
            progress,
            message: message.into(),
        },
    );
}

fn begin_task(state: &NativeAsrState, task_id: &str) -> Result<Arc<AtomicBool>, String> {
    let mut tasks = state
        .tasks
        .lock()
        .map_err(|_| "本地任务状态不可用".to_string())?;
    if !tasks.is_empty() {
        return Err("本地模型正在处理其他任务，请等待完成或先停止当前任务。".to_string());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    tasks.insert(task_id.to_string(), cancelled.clone());
    Ok(cancelled)
}

fn finish_task(state: &NativeAsrState, task_id: &str) {
    if let Ok(mut tasks) = state.tasks.lock() {
        tasks.remove(task_id);
    }
}

fn header(request: &tauri::ipc::Request<'_>, name: &str) -> Result<String, String> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
        .ok_or_else(|| format!("缺少本地转写参数：{name}"))
}

#[tauri::command]
pub fn native_asr_capabilities() -> NativeAsrCapabilities {
    NativeAsrCapabilities {
        available: cfg!(target_os = "macos"),
        backend: if cfg!(target_os = "macos") {
            "whisper.cpp + Metal"
        } else {
            "unavailable"
        },
    }
}

#[tauri::command]
pub async fn native_asr_model_status(app: AppHandle, model_id: String) -> Result<bool, String> {
    let spec = model_spec(&model_id)?;
    let path = model_path(&app, &model_id)?;
    Ok(tokio::fs::metadata(path)
        .await
        .map(|metadata| metadata.len() >= spec.minimum_size)
        .unwrap_or(false))
}

#[tauri::command]
pub async fn native_asr_install_model(
    app: AppHandle,
    state: State<'_, NativeAsrState>,
    model_id: String,
    task_id: String,
) -> Result<(), String> {
    let cancelled = begin_task(&state, &task_id)?;
    let result = install_model(&app, &model_id, &task_id, &cancelled).await;
    finish_task(&state, &task_id);
    result
}

async fn install_model(
    app: &AppHandle,
    model_id: &str,
    task_id: &str,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    let spec = model_spec(model_id)?;
    let directory = model_dir(app)?;
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| format!("无法创建模型目录：{error}"))?;
    let destination = directory.join(spec.file_name);
    if tokio::fs::metadata(&destination)
        .await
        .map(|metadata| metadata.len() >= spec.minimum_size)
        .unwrap_or(false)
    {
        if verify_model(&destination).is_ok() {
            emit_progress(app, task_id, 100, "模型已安装并通过原生引擎校验");
            return Ok(());
        }
        tokio::fs::remove_file(&destination)
            .await
            .map_err(|error| format!("无法替换损坏的模型文件：{error}"))?;
    }

    let partial = destination.with_extension("bin.part");
    let existing = tokio::fs::metadata(&partial)
        .await
        .map(|item| item.len())
        .unwrap_or(0);
    let client = reqwest::Client::new();
    let mut request = client.get(spec.url);
    if existing > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={existing}-"));
    }
    emit_progress(app, task_id, 0, "正在连接模型下载服务…");
    let response = request
        .send()
        .await
        .map_err(|error| format!("模型下载连接失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("模型下载失败，服务返回 {}", response.status()));
    }
    let resumed = existing > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let base = if resumed { existing } else { 0 };
    let total = base + response.content_length().unwrap_or(0);
    let mut file = if resumed {
        tokio::fs::OpenOptions::new()
            .append(true)
            .open(&partial)
            .await
    } else {
        tokio::fs::File::create(&partial).await
    }
    .map_err(|error| format!("无法写入模型文件：{error}"))?;
    let mut downloaded = base;
    let mut last_progress = u8::MAX;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancelled.load(Ordering::Relaxed) {
            return Err("模型下载已暂停，可稍后继续。".to_string());
        }
        let chunk = chunk.map_err(|error| format!("模型下载中断：{error}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("模型写入失败：{error}"))?;
        downloaded += chunk.len() as u64;
        let progress = if total > 0 {
            ((downloaded.saturating_mul(99) / total).min(99)) as u8
        } else {
            0
        };
        if progress != last_progress {
            last_progress = progress;
            emit_progress(
                app,
                task_id,
                progress,
                format!(
                    "正在下载原生 Metal 模型 · {} MB / {} MB",
                    downloaded / 1_048_576,
                    total / 1_048_576
                ),
            );
        }
    }
    file.flush()
        .await
        .map_err(|error| format!("模型写入失败：{error}"))?;
    drop(file);
    let size = tokio::fs::metadata(&partial)
        .await
        .map_err(|error| error.to_string())?
        .len();
    if size < spec.minimum_size {
        return Err("模型文件不完整，请继续下载。".to_string());
    }
    tokio::fs::rename(&partial, &destination)
        .await
        .map_err(|error| format!("模型安装失败：{error}"))?;
    emit_progress(app, task_id, 99, "正在校验模型并初始化 Metal 引擎…");
    verify_model(&destination)?;
    emit_progress(app, task_id, 100, "模型已安装并通过原生引擎校验");
    Ok(())
}

#[cfg(target_os = "macos")]
fn verify_model(path: &Path) -> Result<(), String> {
    WhisperContext::new_with_params(
        path.to_string_lossy().as_ref(),
        WhisperContextParameters::default(),
    )
    .map(|_| ())
    .map_err(|error| format!("模型校验失败：{error}"))
}

#[cfg(not(target_os = "macos"))]
fn verify_model(_path: &Path) -> Result<(), String> {
    Err("原生本地转写当前仅支持 macOS".to_string())
}

#[tauri::command]
pub async fn native_asr_delete_model(app: AppHandle, model_id: String) -> Result<(), String> {
    let path = model_path(&app, &model_id)?;
    let partial = path.with_extension("bin.part");
    for target in [path, partial] {
        match tokio::fs::remove_file(target).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("删除模型失败：{error}")),
        }
    }
    Ok(())
}

#[tauri::command]
pub fn native_asr_cancel(state: State<'_, NativeAsrState>) {
    if let Ok(tasks) = state.tasks.lock() {
        for cancelled in tasks.values() {
            cancelled.store(true, Ordering::Relaxed);
        }
    }
    if let Ok(mut inputs) = state.audio_inputs.lock() {
        inputs.clear();
    }
}

#[tauri::command]
pub fn native_asr_stage_audio(
    state: State<'_, NativeAsrState>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let task_id = header(&request, "x-task-id")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("本地转写音频格式无效".to_string());
    };
    if bytes.len() % 4 != 0 {
        return Err("本地转写音频数据不完整".to_string());
    }
    let samples = bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect::<Vec<_>>();
    begin_task(&state, &task_id)?;
    match state.audio_inputs.lock() {
        Ok(mut audio_inputs) => {
            audio_inputs.insert(task_id, samples);
        }
        Err(_) => {
            finish_task(&state, &task_id);
            return Err("本地音频暂存不可用".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn native_asr_transcribe(
    app: AppHandle,
    state: State<'_, NativeAsrState>,
    model_id: String,
    task_id: String,
) -> Result<NativeAsrResult, String> {
    let samples = match state
        .audio_inputs
        .lock()
        .map_err(|_| "本地音频暂存不可用".to_string())?
        .remove(&task_id)
    {
        Some(samples) => samples,
        None => {
            finish_task(&state, &task_id);
            return Err("找不到待转写的本地音频，请重试。".to_string());
        }
    };
    let cancelled = state
        .tasks
        .lock()
        .map_err(|_| "本地任务状态不可用".to_string())?
        .get(&task_id)
        .cloned()
        .ok_or_else(|| "本地转写任务已停止。".to_string())?;
    if cancelled.load(Ordering::Relaxed) {
        finish_task(&state, &task_id);
        return Err("已停止本次转写，原始录音已保留。".to_string());
    }
    let path = match model_path(&app, &model_id) {
        Ok(path) => path,
        Err(error) => {
            finish_task(&state, &task_id);
            return Err(error);
        }
    };
    if !path.exists() {
        finish_task(&state, &task_id);
        return Err("Mac 原生模型尚未安装。请到设置中删除旧模型状态后重新下载。".to_string());
    }
    let task_app = app.clone();
    let task_id_clone = task_id.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        transcribe_native(&task_app, &task_id_clone, &path, samples, cancelled)
    })
    .await;
    finish_task(&state, &task_id);
    joined.map_err(|error| format!("原生转写进程异常：{error}"))?
}

#[cfg(target_os = "macos")]
fn transcribe_native(
    app: &AppHandle,
    task_id: &str,
    path: &Path,
    samples: Vec<f32>,
    cancelled: Arc<AtomicBool>,
) -> Result<NativeAsrResult, String> {
    if samples.is_empty() {
        return Ok(NativeAsrResult {
            text: String::new(),
            chunks: Vec::new(),
        });
    }
    emit_progress(app, task_id, 0, "正在加载 Mac 原生 Metal 模型…");
    let context = WhisperContext::new_with_params(
        path.to_string_lossy().as_ref(),
        WhisperContextParameters::default(),
    )
    .map_err(|error| format!("无法加载原生模型：{error}"))?;
    let mut state = context
        .create_state()
        .map_err(|error| format!("无法初始化原生转写：{error}"))?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    let threads = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(4)
        .clamp(2, 8) as i32;
    params.set_n_threads(threads);
    params.set_language(Some("zh"));
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    let progress_app = app.clone();
    let progress_task = task_id.to_string();
    params.set_progress_callback_safe(Some(move |progress: i32| {
        emit_progress(
            &progress_app,
            &progress_task,
            progress.clamp(0, 99) as u8,
            format!("Metal 正在转写 · 已处理约 {progress}%"),
        );
    }));
    let abort_flag = cancelled.clone();
    params.set_abort_callback_safe(Some(move || abort_flag.load(Ordering::Relaxed)));
    state.full(params, &samples).map_err(|error| {
        if cancelled.load(Ordering::Relaxed) {
            "已停止本次转写，原始录音已保留。".to_string()
        } else {
            format!("原生转写失败：{error}")
        }
    })?;
    if cancelled.load(Ordering::Relaxed) {
        return Err("已停止本次转写，原始录音已保留。".to_string());
    }
    emit_progress(app, task_id, 99, "识别完成，正在整理时间戳和逐字稿…");
    let count = state.full_n_segments();
    let mut chunks = Vec::with_capacity(count as usize);
    for index in 0..count {
        let segment = state
            .get_segment(index)
            .ok_or_else(|| "无法读取识别分段".to_string())?;
        let text = segment
            .to_str_lossy()
            .map_err(|error| error.to_string())?
            .trim()
            .to_string();
        if text.is_empty() {
            continue;
        }
        let start = segment.start_timestamp() as f64 / 100.0;
        let end = segment.end_timestamp() as f64 / 100.0;
        chunks.push(NativeAsrSegment {
            text,
            timestamp: [start, end],
        });
    }
    let text = chunks
        .iter()
        .map(|chunk| chunk.text.as_str())
        .collect::<Vec<_>>()
        .join("");
    emit_progress(app, task_id, 100, "Mac 原生转写完成");
    Ok(NativeAsrResult { text, chunks })
}

#[cfg(not(target_os = "macos"))]
fn transcribe_native(
    _app: &AppHandle,
    _task_id: &str,
    _path: &Path,
    _samples: Vec<f32>,
    _cancelled: Arc<AtomicBool>,
) -> Result<NativeAsrResult, String> {
    Err("原生本地转写当前仅支持 macOS".to_string())
}
