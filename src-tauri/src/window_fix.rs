//! 跨平台的主窗口恢复与防白屏补丁。
//!
//! 解决以下平台的渲染与交互问题：
//!
//! 1. **Linux**：
//!    - **失效模式 A**（Tauri #10746 / wry #637）：webview 在 `show()` 后没有获得 keyboard focus，
//!      导致首次点击被 X11/Wayland 用作 click-to-activate 而非传给 webview。
//!    - **失效模式 B**：GTK surface 与 WebKitWebView 的 input region 尺寸协商在 `visible:false` → `show()`
//!      的路径上失败，整窗永远不响应点击，只有重新 `size_allocate`（例如最大化-还原）才能恢复。
//!
//! 2. **Windows**：
//!    - **白屏/重绘失效模式**：WebView2 在从托盘最小化/隐藏后再 `show()` 时，偶尔由于渲染上下文挂起
//!      或者 DWM 帧丢失导致界面呈现纯白。通过一次 ±1px 的伪 resize 可以强制 WebView2 重新分配渲染缓冲区并重绘，
//!      从而完美唤醒并恢复界面渲染。

use std::time::Duration;
use tauri::{PhysicalSize, WebviewWindow};

/// Linux 等待主循环 realize 的延迟。
#[cfg(target_os = "linux")]
const REALIZE_WAIT: Duration = Duration::from_millis(200);

/// ±1px 伪 resize 两步之间的间隔。
const RESIZE_GAP: Duration = Duration::from_millis(100);

/// 尺寸对账回读前的额外等待（Linux 专用）。
#[cfg(target_os = "linux")]
const RECONCILE_WAIT: Duration = Duration::from_millis(500);

/// 对主窗口执行跨平台的「focus + surface 重激活 (nudge)」序列。
///
/// 调用是 fire-and-forget：内部 spawn 一个异步任务。
/// 调用线程立即返回，不阻塞 UI。
pub(crate) fn nudge_main_window(window: WebviewWindow) {
    let _ = window.set_focus();

    tauri::async_runtime::spawn(async move {
        #[cfg(target_os = "linux")]
        {
            tokio::time::sleep(REALIZE_WAIT).await;
            let _ = window.set_focus();
        }

        #[cfg(target_os = "windows")]
        {
            // Windows 上在窗口显示后，稍作等待再进行重绘 nudge，给 DWM/WebView2 创建和恢复渲染通道留出时间。
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        match window.inner_size() {
            Ok(original) => {
                let bumped = PhysicalSize::new(original.width.saturating_add(1), original.height);
                let _ = window.set_size(bumped);
                tokio::time::sleep(RESIZE_GAP).await;
                let _ = window.set_size(original);

                #[cfg(target_os = "linux")]
                log::info!("Linux: 已对主窗口执行 focus + surface 重激活");
                #[cfg(target_os = "windows")]
                log::info!("Windows: 已对主窗口执行重绘以防止白屏");

                #[cfg(target_os = "linux")]
                {
                    tokio::time::sleep(RECONCILE_WAIT).await;
                    match window.inner_size() {
                        Ok(after) => {
                            if after.width != original.width || after.height != original.height {
                                log::info!(
                                    "Linux nudge 尺寸 drift: expected={}x{}, got={}x{}，已补偿",
                                    original.width,
                                    original.height,
                                    after.width,
                                    after.height
                                );
                                let _ = window.set_size(original);
                                if let Ok(final_size) = window.inner_size() {
                                    if final_size.width != original.width
                                        || final_size.height != original.height
                                    {
                                        log::warn!(
                                            "Linux nudge 尺寸 drift 补偿后仍不一致: expected={}x{}, got={}x{}",
                                            original.width,
                                            original.height,
                                            final_size.width,
                                            final_size.height
                                        );
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            log::warn!("Linux nudge: 对账回读 inner_size 失败: {e}");
                        }
                    }
                }
            }
            Err(e) => {
                log::warn!("Window nudge: 读取 inner_size 失败，跳过伪 resize: {e}");
            }
        }
    });
}
