//! 代理服务器池相关命令
//!
//! 提供代理服务器池的增删改查、连通性测试和本地代理扫描能力。
use crate::database::dao::proxy_servers::{DeleteProxyServerResult, ProxyServer};
use crate::proxy::http_client;
use crate::store::AppState;
use serde::{Deserialize, Serialize};
use std::net::{Ipv4Addr, SocketAddrV4, TcpStream};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyServerPayload {
    pub id: String,
    pub name: String,
    pub url: String,
    pub sort_index: Option<i64>,
}

#[tauri::command]
pub fn get_proxy_servers(state: tauri::State<'_, AppState>) -> Result<Vec<ProxyServer>, String> {
    state.db.list_proxy_servers().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_proxy_servers(
    state: tauri::State<'_, AppState>,
    proxy_servers: Vec<ProxyServerPayload>,
) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    for item in proxy_servers {
        let name = item.name.trim();
        let url = item.url.trim();
        if name.is_empty() {
            return Err("Proxy server name is required".to_string());
        }
        if url.is_empty() {
            return Err("Proxy server URL is required".to_string());
        }

        http_client::validate_proxy(Some(url))?;

        let existing = state
            .db
            .get_proxy_server_by_id(&item.id)
            .map_err(|e| e.to_string())?;
        let created_at = existing.as_ref().map(|v| v.created_at).unwrap_or(now);

        state
            .db
            .save_proxy_server(&ProxyServer {
                id: item.id,
                name: name.to_string(),
                url: url.to_string(),
                sort_index: item.sort_index,
                created_at,
                updated_at: now,
            })
            .map_err(map_proxy_server_db_error)?;
    }

    Ok(())
}

#[tauri::command]
pub fn delete_proxy_server(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<DeleteProxyServerResult, String> {
    state.db.delete_proxy_server(&id).map_err(|e| e.to_string())
}

/// 代理测试结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyTestResult {
    pub success: bool,
    pub latency_ms: u64,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn test_proxy_url(url: String) -> Result<ProxyTestResult, String> {
    if url.trim().is_empty() {
        return Err("Proxy URL is empty".to_string());
    }

    let start = Instant::now();
    let proxy = reqwest::Proxy::all(&url).map_err(|e| format!("Invalid proxy URL: {e}"))?;

    let client = reqwest::Client::builder()
        .proxy(proxy)
        .timeout(std::time::Duration::from_secs(10))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build client: {e}"))?;

    let test_urls = [
        "https://httpbin.org/get",
        "https://www.google.com",
        "https://api.anthropic.com",
    ];

    let mut last_error = None;

    for test_url in test_urls {
        match client.head(test_url).send().await {
            Ok(resp) => {
                let latency = start.elapsed().as_millis() as u64;
                log::debug!(
                    "[ProxyPool] Test successful: {} -> {} via {} ({}ms)",
                    http_client::mask_url(&url),
                    test_url,
                    resp.status(),
                    latency
                );
                return Ok(ProxyTestResult {
                    success: true,
                    latency_ms: latency,
                    error: None,
                });
            }
            Err(e) => {
                log::debug!("[ProxyPool] Test to {test_url} failed: {e}");
                last_error = Some(e);
            }
        }
    }

    let latency = start.elapsed().as_millis() as u64;
    let error_msg = last_error
        .map(|e| e.to_string())
        .unwrap_or_else(|| "All test targets failed".to_string());

    Ok(ProxyTestResult {
        success: false,
        latency_ms: latency,
        error: Some(error_msg),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedProxy {
    pub url: String,
    pub proxy_type: String,
    pub port: u16,
}

const PROXY_PORTS: &[(u16, &str, bool)] = &[
    (7890, "http", true),
    (7891, "socks5", false),
    (1080, "socks5", false),
    (8080, "http", false),
    (8888, "http", false),
    (3128, "http", false),
    (10808, "socks5", false),
    (10809, "http", false),
];

#[tauri::command]
pub async fn scan_local_proxies() -> Vec<DetectedProxy> {
    tokio::task::spawn_blocking(|| {
        let mut found = Vec::new();

        for &(port, primary_type, is_mixed) in PROXY_PORTS {
            let addr = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
            if TcpStream::connect_timeout(&addr.into(), Duration::from_millis(100)).is_ok() {
                found.push(DetectedProxy {
                    url: format!("{primary_type}://127.0.0.1:{port}"),
                    proxy_type: primary_type.to_string(),
                    port,
                });

                if is_mixed {
                    let alt_type = if primary_type == "http" {
                        "socks5"
                    } else {
                        "http"
                    };
                    found.push(DetectedProxy {
                        url: format!("{alt_type}://127.0.0.1:{port}"),
                        proxy_type: alt_type.to_string(),
                        port,
                    });
                }
            }
        }

        found
    })
    .await
    .unwrap_or_default()
}

fn map_proxy_server_db_error(error: crate::error::AppError) -> String {
    let text = error.to_string();
    if text.contains("UNIQUE constraint failed: proxy_servers.name") {
        return "Proxy server name must be unique".to_string();
    }
    if text.contains("UNIQUE constraint failed: proxy_servers.url") {
        return "Proxy server URL must be unique".to_string();
    }
    text
}
