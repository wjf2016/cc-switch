import type { AppId } from "@/lib/api";
import type { Provider } from "@/types";

/**
 * 支持导出导入深链接的应用,与后端 `parse_provider_deeplink` 的白名单一致
 * (src-tauri/src/deeplink/parser.rs)。pi 与 claude-desktop 不在其中,
 * 导出的链接会因 app 校验失败而无法导入,因此不提供导出入口。
 */
export const DEEPLINK_EXPORT_APP_IDS: readonly AppId[] = [
  "claude",
  "codex",
  "gemini",
  "grokbuild",
  "opencode",
  "openclaw",
  "hermes",
];

/** UTF-8 安全的 Base64 编码,与 src/lib/utils/base64.ts 的解码语义配套 */
function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** URL-safe Base64(usageScript 参数沿用 deplink.html 生成器的编码约定) */
function encodeUrlSafeBase64Utf8(text: string): string {
  return encodeBase64Utf8(text)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * 构造供应商的 ccswitch:// 导入深链接。
 *
 * 完整 settingsConfig 经 Base64 编码放进 `config` 参数,导入端
 * (src-tauri/src/deeplink/provider.rs)会从中提取 api_key/endpoint/model
 * 等字段,因此这里不再生成 endpoint/apiKey/model 等 URL 覆盖参数——
 * 那些参数是第三方链接构造方的入口,导出场景下只会造成冗余。
 *
 * @param provider 供应商对象
 * @param appId 目标应用 ID
 * @param options 可选配置
 * @param options.includeCredentials 是否包含 API Key 等敏感凭据(默认 true)
 */
export function buildProviderDeepLink(
  provider: Provider,
  appId: AppId,
  options?: { includeCredentials?: boolean },
): string {
  const includeCredentials = options?.includeCredentials ?? true;

  // 若不包含凭据,清洗 settingsConfig
  let configToExport = provider.settingsConfig ?? {};
  if (!includeCredentials) {
    configToExport = sanitizeCredentials(configToExport, appId);
  }

  const params = new URLSearchParams({
    resource: "provider",
    app: appId,
    name: provider.name,
    configFormat: "json",
    config: encodeBase64Utf8(JSON.stringify(configToExport)),
  });

  if (provider.websiteUrl?.trim()) {
    params.set("homepage", provider.websiteUrl.trim());
  }
  if (provider.icon?.trim()) {
    params.set("icon", provider.icon.trim());
  }
  if (provider.notes?.trim()) {
    params.set("notes", provider.notes.trim());
  }

  // 用量查询脚本(v3.9+ 参数)。templateType 及火山方舟/智谱签名字段
  // 在深链接协议中没有对应参数,无法随链接迁移。
  const usage = provider.meta?.usage_script;
  if (usage) {
    if (usage.enabled) {
      params.set("usageEnabled", "true");
    }
    if (usage.code?.trim()) {
      params.set("usageScript", encodeUrlSafeBase64Utf8(usage.code));
    }
    if (usage.baseUrl?.trim()) {
      params.set("usageBaseUrl", usage.baseUrl.trim());
    }
    if (usage.apiKey?.trim()) {
      params.set("usageApiKey", usage.apiKey.trim());
    }
    if (usage.accessToken?.trim()) {
      params.set("usageAccessToken", usage.accessToken.trim());
    }
    if (usage.userId?.trim()) {
      params.set("usageUserId", usage.userId.trim());
    }
    if (usage.autoQueryInterval) {
      params.set("usageAutoInterval", String(usage.autoQueryInterval));
    }
  }

  return `ccswitch://v1/import?${params.toString()}`;
}

/**
 * 将 settingsConfig 中的敏感凭据字段替换为占位符,返回处理后的副本。
 * 占位符固定为"请修改key",提示用户导入后需手动填写真实凭据。
 * 支持的应用配置结构:
 * - Claude: { env: { ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL } }
 * - Codex: { auth: { apiKey }, config: { baseUrl } }
 * - Gemini: { env: { GEMINI_API_KEY, GOOGLE_GEMINI_BASE_URL } }
 * - GrokBuild: { env: { GROK_API_KEY, XAI_API_BASE_URL } }
 * - OpenCode/OpenClaw/Hermes: { apiKey, baseUrl, ... }
 */
function sanitizeCredentials(
  config: Record<string, any>,
  appId: AppId,
): Record<string, any> {
  const sanitized = JSON.parse(JSON.stringify(config)); // 深拷贝
  const PLACEHOLDER = "请修改key";

  switch (appId) {
    case "claude":
    case "gemini":
    case "grokbuild":
      // .env 格式应用:替换 *_KEY / *_TOKEN 字段为占位符
      if (sanitized.env && typeof sanitized.env === "object") {
        for (const key of Object.keys(sanitized.env)) {
          if (
            key.includes("KEY") ||
            key.includes("TOKEN") ||
            key.includes("SECRET")
          ) {
            sanitized.env[key] = PLACEHOLDER;
          }
        }
      }
      break;

    case "codex":
      // Codex: { auth: { apiKey }, config: {...} }
      if (sanitized.auth && typeof sanitized.auth === "object") {
        sanitized.auth.apiKey = PLACEHOLDER;
      }
      break;

    case "opencode":
    case "openclaw":
    case "hermes":
      // Additive app: 顶级 apiKey 字段
      if (sanitized.apiKey !== undefined) {
        sanitized.apiKey = PLACEHOLDER;
      }
      break;

    default:
      // 其他应用:保守策略,替换常见凭据字段名
      if (sanitized.apiKey !== undefined) {
        sanitized.apiKey = PLACEHOLDER;
      }
      if (sanitized.api_key !== undefined) {
        sanitized.api_key = PLACEHOLDER;
      }
      if (sanitized.env && typeof sanitized.env === "object") {
        for (const key of Object.keys(sanitized.env)) {
          if (
            key.includes("KEY") ||
            key.includes("TOKEN") ||
            key.includes("SECRET")
          ) {
            sanitized.env[key] = PLACEHOLDER;
          }
        }
      }
  }

  return sanitized;
}
