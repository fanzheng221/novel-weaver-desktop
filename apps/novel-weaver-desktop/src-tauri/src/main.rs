mod byok;
use std::{
    env,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

const KEYRING_SERVICE: &str = "local.novelweaver.desktop";

#[derive(Deserialize, Serialize)]
struct DesktopRequest {
    cwd: String,
    request: Value,
}

#[tauri::command]
async fn query_project(app: tauri::AppHandle, cwd: String, request: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_project_query(app, cwd, request))
        .await.map_err(|error| error.to_string())?
}

fn run_project_query(app: tauri::AppHandle, cwd: String, request: Value) -> Result<Value, String> {
    let payload = serde_json::to_string(&DesktopRequest { cwd, request })
        .map_err(|error| error.to_string())?;
    let mut command = Command::new(node_binary(&app)?);
    command.arg(core_script(&app)?);
    // 生产包：原生依赖与迁移 SQL 随 resources 分发，经环境变量注入解析路径。
    if let Some(bundled_dir) = bundled_resources_dir(&app) {
        let node_modules = bundled_dir.join("node_modules");
        if node_modules.is_dir() {
            command.env("NODE_PATH", &node_modules);
        }
        let migrations = bundled_dir.join("migrations");
        if migrations.is_dir() {
            command.env("NOVEL_WEAVER_MIGRATIONS_DIR", migrations);
        }
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动 Novel Weaver 本地核心：{error}"))?;
    let mut stdin = child.stdin.take().ok_or("无法打开本地核心输入流")?;
    stdin
        .write_all(format!("{payload}\n").as_bytes())
        .map_err(|error| error.to_string())?;
    drop(stdin);
    let output = child
        .wait_with_output()
        .map_err(|error| error.to_string())?;
    let diagnostics = String::from_utf8_lossy(&output.stderr);
    let diagnostics = diagnostics.trim();
    if !diagnostics.is_empty() {
        eprintln!("Novel Weaver 本地核心诊断输出：{diagnostics}");
    }
    let response: Value = serde_json::from_slice(&output.stdout).map_err(|error| {
        let detail = if diagnostics.is_empty() {
            String::new()
        } else {
            format!("；核心诊断：{diagnostics}")
        };
        format!("本地核心返回了无效响应：{error}{detail}")
    })?;
    if response.get("ok") == Some(&Value::Bool(true)) {
        Ok(response)
    } else {
        Err(response
            .pointer("/error/message")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| {
                if diagnostics.is_empty() {
                    "本地核心请求失败".into()
                } else {
                    format!("本地核心请求失败；核心诊断：{diagnostics}")
                }
            }))
    }
}

fn node_binary(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = env::var("NOVEL_WEAVER_NODE") { return Ok(PathBuf::from(path)); }
    let name = if cfg!(windows) { "node.exe" } else { "node" };
    if let Some(path) = bundled_resources_dir(app).map(|dir| dir.join("runtime").join(name)) {
        if path.is_file() { return Ok(path); }
    }
    if cfg!(debug_assertions) { return Ok(PathBuf::from("node")); }
    Err("安装包缺少 Node 运行时，请重新安装完整应用。".into())
}

fn core_script(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = env::var("NOVEL_WEAVER_CORE_SCRIPT") {
        return Ok(PathBuf::from(path));
    }
    if let Some(bundled) =
        bundled_resources_dir(app).map(|dir| dir.join("novel-weaver-local-core.cjs"))
    {
        if bundled.exists() {
            return Ok(bundled);
        }
    }
    if !cfg!(debug_assertions) { return Err("安装包缺少本地核心，请重新安装完整应用。".into()); }
    // 开发回退：未打包时直接跑 workspace 里的 TS 入口。
    let dev_entry = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../local-core/cli.ts");
    dev_entry.exists().then_some(dev_entry).ok_or_else(|| {
        "找不到 Novel Weaver 本地核心入口。请先在仓库根目录运行 pnpm install 安装工作区依赖。"
            .into()
    })
}

/// 打包时 tauri.conf 的 resources 条目保留目录名，落在 $RESOURCE/resources/ 下。
fn bundled_resources_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let nested = resource_dir.join("resources");
    (nested.is_dir()).then_some(nested).or(Some(resource_dir))
}

fn keyring_entry(provider_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, provider_id)
        .map_err(|error| format!("钥匙串初始化失败：{error}"))
}

#[tauri::command]
fn byok_save_key(provider_id: String, key: String) -> Result<(), String> {
    keyring_entry(&provider_id)?
        .set_password(&key)
        .map_err(|error| format!("保存 API Key 失败：{error}"))
}

#[tauri::command]
fn byok_delete_key(provider_id: String) -> Result<(), String> {
    match keyring_entry(&provider_id)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("删除 API Key 失败：{error}")),
    }
}

/// Return only the key suffix to the UI; completion reads the same keychain entry in core.
#[tauri::command]
fn byok_key_tail(provider_id: String) -> Result<Option<String>, String> {
    match keyring_entry(&provider_id)?.get_password() {
        Ok(key) => {
            let tail: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
            Ok(Some(tail))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("读取 API Key 失败：{error}")),
    }
}

fn read_key_for_probe(provider_id: Option<String>, api_key: Option<String>) -> Result<Option<String>, String> {
    if let Some(key) = api_key.filter(|value| !value.trim().is_empty()) {
        return Ok(Some(key));
    }
    match provider_id {
        Some(id) => keyring_entry(&id)?.get_password().map(Some).or_else(|error| match error {
            keyring::Error::NoEntry => Ok(None),
            other => Err(format!("读取 API Key 失败：{other}")),
        }),
        None => Ok(None),
    }
}

/// Legacy probe command retained for older clients.
#[tauri::command]
async fn byok_probe(
    provider_id: Option<String>,
    adapter: String,
    base_url: String,
    model_id: String,
    api_key: Option<String>,
) -> Result<Value, String> {
    let key = read_key_for_probe(provider_id, api_key)?;
    probe_impl(adapter, base_url, model_id, key).await
}

async fn probe_impl(
    adapter: String,
    base_url: String,
    model_id: String,
    key: Option<String>,
) -> Result<Value, String> {
    byok::probe(
        byok::ProbeConfig {
            provider_id: None,
            adapter,
            base_url,
            model_id,
            api_key: None,
            request_options: None,
        },
        key,
    )
    .await
}

#[tauri::command]
async fn byok_probe_config(mut config: byok::ProbeConfig) -> Result<Value, String> {
    let keyless = config
        .request_options
        .as_ref()
        .and_then(|options| options.auth_mode.as_deref())
        == Some("none");
    let key = if keyless {
        None
    } else {
        read_key_for_probe(
            config.provider_id.take().filter(|id| !id.is_empty()),
            config.api_key.take(),
        )?
    };
    byok::probe(config, key).await
}

#[tauri::command]
fn default_project_path() -> Result<String, String> {
    let fallback = env::current_dir().map_err(|error| error.to_string())?;
    let mut cursor = fallback.clone();
    loop {
        if cursor.join(".novel").is_dir() {
            return Ok(cursor.to_string_lossy().into_owned());
        }
        if !cursor.pop() {
            return Ok(fallback.to_string_lossy().into_owned());
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            query_project,
            default_project_path,
            byok_save_key,
            byok_delete_key,
            byok_key_tail,
            byok_probe,
            byok_probe_config
        ])
        .run(tauri::generate_context!())
        .expect("启动 Novel Weaver 桌面端失败");
}
