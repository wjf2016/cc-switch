import { describe, expect, it } from "vitest";
import { buildProviderDeepLink } from "@/utils/providerDeepLink";
import type { Provider } from "@/types";

const baseProvider: Provider = {
  id: "p1",
  name: "Sub2API",
  settingsConfig: {
    env: {
      ANTHROPIC_AUTH_TOKEN: "sk-test+abc/def=",
      ANTHROPIC_BASE_URL: "https://sub2api.afu.ink",
    },
  },
};

/** 模拟后端 `url::Url::query_pairs` 的解析路径(percent-decoding 含 +/%2B) */
function parseQuery(link: string): URLSearchParams {
  const query = link.slice("ccswitch://v1/import?".length);
  return new URLSearchParams(query);
}

/** 解码 UTF-8 Base64（与 encodeBase64Utf8 对应） */
function decodeBase64Utf8(encoded: string): string {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

describe("buildProviderDeepLink", () => {
  it("把完整 settingsConfig 编码进 config 参数且可无损还原", () => {
    const link = buildProviderDeepLink(baseProvider, "claude");
    expect(link.startsWith("ccswitch://v1/import?")).toBe(true);

    const params = parseQuery(link);
    expect(params.get("resource")).toBe("provider");
    expect(params.get("app")).toBe("claude");
    expect(params.get("name")).toBe("Sub2API");
    expect(params.get("configFormat")).toBe("json");
    // API Key 中的 +/= 经 URLSearchParams percent-encode 后必须原样还原,
    // 否则后端解码出的配置会静默损坏
    expect(JSON.parse(decodeBase64Utf8(params.get("config")!))).toEqual(
      baseProvider.settingsConfig,
    );
  });

  it("携带官网、图标、备注与用量查询脚本字段", () => {
    const provider: Provider = {
      ...baseProvider,
      websiteUrl: "https://sub2api.afu.ink/",
      icon: "OpenAI",
      notes: "外网入口",
      meta: {
        usage_script: {
          enabled: true,
          language: "javascript",
          code: '({ request: { url: "https://x/api" } })',
          timeout: 10,
          autoQueryInterval: 30,
        },
      },
    };

    const params = parseQuery(buildProviderDeepLink(provider, "claude"));
    expect(params.get("homepage")).toBe("https://sub2api.afu.ink/");
    expect(params.get("icon")).toBe("OpenAI");
    expect(params.get("notes")).toBe("外网入口");
    expect(params.get("usageEnabled")).toBe("true");
    expect(params.get("usageAutoInterval")).toBe("30");
    // usageScript 为 URL-safe Base64:不含 + / = 字符
    const script = params.get("usageScript")!;
    expect(script).not.toMatch(/[+/=]/);
    const padded = script.replace(/-/g, "+").replace(/_/g, "/");
    expect(atob(padded)).toBe(provider.meta!.usage_script!.code);
  });

  it("缺省的可选字段不出现在链接中", () => {
    const params = parseQuery(buildProviderDeepLink(baseProvider, "codex"));
    expect(params.get("homepage")).toBeNull();
    expect(params.get("icon")).toBeNull();
    expect(params.get("notes")).toBeNull();
    expect(params.get("usageEnabled")).toBeNull();
    expect(params.get("usageScript")).toBeNull();
    expect(params.get("enabled")).toBeNull();
  });

  it("禁用的用量脚本只导出代码、不声明启用", () => {
    const provider: Provider = {
      ...baseProvider,
      meta: {
        usage_script: {
          enabled: false,
          language: "javascript",
          code: "({})",
          timeout: 10,
        },
      },
    };

    const params = parseQuery(buildProviderDeepLink(provider, "claude"));
    expect(params.get("usageEnabled")).toBeNull();
    expect(params.get("usageScript")).toBeTruthy();
  });

  it("includeCredentials=false 时将 Claude 的 ANTHROPIC_AUTH_TOKEN 替换为占位符", () => {
    const link = buildProviderDeepLink(baseProvider, "claude", {
      includeCredentials: false,
    });
    const params = parseQuery(link);
    const configB64 = params.get("config")!;
    const configJson = JSON.parse(decodeBase64Utf8(configB64));

    expect(configJson.env.ANTHROPIC_BASE_URL).toBe("https://sub2api.afu.ink");
    expect(configJson.env.ANTHROPIC_AUTH_TOKEN).toBe("请修改key");
  });

  it("includeCredentials=false 时将 Codex 的 apiKey 替换为占位符", () => {
    const codexProvider: Provider = {
      id: "c1",
      name: "Codex",
      settingsConfig: {
        auth: { apiKey: "sk-codex-secret" },
        config: { baseUrl: "https://api.codex.test" },
      },
    };

    const link = buildProviderDeepLink(codexProvider, "codex", {
      includeCredentials: false,
    });
    const params = parseQuery(link);
    const configJson = JSON.parse(decodeBase64Utf8(params.get("config")!));

    expect(configJson.auth.apiKey).toBe("请修改key");
    expect(configJson.config.baseUrl).toBe("https://api.codex.test");
  });

  it("includeCredentials=false 时将 Gemini 的 GEMINI_API_KEY 替换为占位符", () => {
    const geminiProvider: Provider = {
      id: "g1",
      name: "Gemini",
      settingsConfig: {
        env: {
          GEMINI_API_KEY: "AIza-secret",
          GOOGLE_GEMINI_BASE_URL: "https://generativelanguage.googleapis.com",
        },
      },
    };

    const link = buildProviderDeepLink(geminiProvider, "gemini", {
      includeCredentials: false,
    });
    const params = parseQuery(link);
    const configJson = JSON.parse(decodeBase64Utf8(params.get("config")!));

    expect(configJson.env.GEMINI_API_KEY).toBe("请修改key");
    expect(configJson.env.GOOGLE_GEMINI_BASE_URL).toBe(
      "https://generativelanguage.googleapis.com",
    );
  });

  it("includeCredentials=false 时将 OpenCode 的 apiKey 替换为占位符", () => {
    const opencodeProvider: Provider = {
      id: "oc1",
      name: "OpenCode",
      settingsConfig: {
        apiKey: "sk-opencode-secret",
        baseUrl: "https://api.opencode.test",
      },
    };

    const link = buildProviderDeepLink(opencodeProvider, "opencode", {
      includeCredentials: false,
    });
    const params = parseQuery(link);
    const configJson = JSON.parse(decodeBase64Utf8(params.get("config")!));

    expect(configJson.apiKey).toBe("请修改key");
    expect(configJson.baseUrl).toBe("https://api.opencode.test");
  });

  it("includeCredentials 默认为 true", () => {
    const link = buildProviderDeepLink(baseProvider, "claude");
    const params = parseQuery(link);
    const configJson = JSON.parse(decodeBase64Utf8(params.get("config")!));

    expect(configJson.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-test+abc/def=");
  });
});
