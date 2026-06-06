/**
 * 全局出站代理 API
 *
 * 提供获取、设置和测试全局代理的功能。
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * 代理测试结果
 */
export interface ProxyTestResult {
  success: boolean;
  latencyMs: number;
  error: string | null;
}

export interface ProxyServer {
  id: string;
  name: string;
  url: string;
  sortIndex?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProxyServerPayload {
  id: string;
  name: string;
  url: string;
  sortIndex?: number;
}

export interface DeleteProxyServerResult {
  deleted: boolean;
  affectedProviders: number;
}

/**
 * 检测到的代理
 */
export interface DetectedProxy {
  url: string;
  proxyType: string;
  port: number;
}

export async function getProxyServers(): Promise<ProxyServer[]> {
  return invoke<ProxyServer[]>("get_proxy_servers");
}

export async function saveProxyServers(
  proxyServers: ProxyServerPayload[],
): Promise<void> {
  try {
    return await invoke("save_proxy_servers", { proxyServers });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : String(error));
  }
}

export async function deleteProxyServer(
  id: string,
): Promise<DeleteProxyServerResult> {
  return invoke<DeleteProxyServerResult>("delete_proxy_server", { id });
}

/**
 * 测试代理连接
 *
 * @param url - 要测试的代理 URL
 * @returns 测试结果，包含是否成功、延迟和错误信息
 */
export async function testProxyUrl(url: string): Promise<ProxyTestResult> {
  return invoke<ProxyTestResult>("test_proxy_url", { url });
}

/**
 * 扫描本地代理
 *
 * @returns 检测到的代理列表
 */
export async function scanLocalProxies(): Promise<DetectedProxy[]> {
  return invoke<DetectedProxy[]>("scan_local_proxies");
}
