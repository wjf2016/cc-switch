import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Pencil, Plus, Search, TestTube2, Trash2 } from "lucide-react";
import {
  useDeleteProxyServer,
  useProxyServers,
  useSaveProxyServers,
  useScanProxies,
  useTestProxy,
  type DetectedProxy,
  type ProxyServer,
} from "@/hooks/useGlobalProxy";

type DraftProxyServer = {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  password: string;
  sortIndex?: number;
};

function extractAuth(url: string): {
  baseUrl: string;
  username: string;
  password: string;
} {
  if (!url.trim()) return { baseUrl: "", username: "", password: "" };

  try {
    const parsed = new URL(url);
    const username = decodeURIComponent(parsed.username || "");
    const password = decodeURIComponent(parsed.password || "");
    parsed.username = "";
    parsed.password = "";
    return { baseUrl: parsed.toString(), username, password };
  } catch {
    return { baseUrl: url, username: "", password: "" };
  }
}

function mergeAuth(
  baseUrl: string,
  username: string,
  password: string,
): string {
  if (!baseUrl.trim()) return "";
  if (!username.trim()) return baseUrl.trim();

  try {
    const parsed = new URL(baseUrl.trim());
    parsed.username = username.trim();
    if (password) {
      parsed.password = password;
    }
    return parsed.toString();
  } catch {
    const match = baseUrl.trim().match(/^(\w+:\/\/)(.+)$/);
    if (match) {
      const auth = password
        ? `${encodeURIComponent(username.trim())}:${encodeURIComponent(password)}@`
        : `${encodeURIComponent(username.trim())}@`;
      return `${match[1]}${auth}${match[2]}`;
    }
    return baseUrl.trim();
  }
}

function toDraft(proxyServer: ProxyServer): DraftProxyServer {
  const { baseUrl, username, password } = extractAuth(proxyServer.url);
  return {
    id: proxyServer.id,
    name: proxyServer.name,
    baseUrl,
    username,
    password,
    sortIndex: proxyServer.sortIndex,
  };
}

function createEmptyDraft(): DraftProxyServer {
  return {
    id: crypto.randomUUID(),
    name: "",
    baseUrl: "",
    username: "",
    password: "",
  };
}

export function GlobalProxySettings() {
  const { t } = useTranslation();
  const { data: proxyServers = [], isLoading } = useProxyServers();
  const saveMutation = useSaveProxyServers();
  const deleteMutation = useDeleteProxyServer();
  const testMutation = useTestProxy();
  const scanMutation = useScanProxies();

  const [drafts, setDrafts] = useState<DraftProxyServer[]>([]);
  const [dirtyIds, setDirtyIds] = useState<string[]>([]);
  const [detected, setDetected] = useState<DetectedProxy[]>([]);

  useEffect(() => {
    setDrafts(proxyServers.map(toDraft));
    setDirtyIds([]);
  }, [proxyServers]);

  const dirtyIdSet = useMemo(() => new Set(dirtyIds), [dirtyIds]);

  const markDirty = (id: string) => {
    setDirtyIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const updateDraft = (
    id: string,
    updater: (draft: DraftProxyServer) => DraftProxyServer,
  ) => {
    setDrafts((prev) =>
      prev.map((item) => (item.id === id ? updater(item) : item)),
    );
    markDirty(id);
  };

  const handleAdd = () => {
    const draft = createEmptyDraft();
    setDrafts((prev) => [...prev, draft]);
    markDirty(draft.id);
  };

  const handleSave = async (draft: DraftProxyServer) => {
    await saveMutation.mutateAsync([
      {
        id: draft.id,
        name: draft.name.trim(),
        url: mergeAuth(draft.baseUrl, draft.username, draft.password),
        sortIndex: draft.sortIndex,
      },
    ]);
    setDirtyIds((prev) => prev.filter((item) => item !== draft.id));
  };

  const handleDelete = async (draft: DraftProxyServer) => {
    const existsInBackend = proxyServers.some((item) => item.id === draft.id);
    if (!existsInBackend) {
      setDrafts((prev) => prev.filter((item) => item.id !== draft.id));
      setDirtyIds((prev) => prev.filter((item) => item !== draft.id));
      return;
    }
    await deleteMutation.mutateAsync(draft.id);
  };

  const handleTest = async (draft: DraftProxyServer) => {
    const fullUrl = mergeAuth(draft.baseUrl, draft.username, draft.password);
    if (fullUrl) {
      await testMutation.mutateAsync(fullUrl);
    }
  };

  const handleScan = async () => {
    const result = await scanMutation.mutateAsync();
    setDetected(result);
  };

  const handleSelectDetected = (proxyUrl: string) => {
    const lastDraft = drafts[drafts.length - 1];
    const { baseUrl, username, password } = extractAuth(proxyUrl);
    if (!lastDraft) {
      const draft = createEmptyDraft();
      setDrafts((prev) => [
        ...prev,
        {
          ...draft,
          baseUrl,
          username,
          password,
        },
      ]);
      markDirty(draft.id);
      setDetected([]);
      return;
    }

    updateDraft(lastDraft.id, (draft) => ({
      ...draft,
      baseUrl,
      username,
      password,
    }));
    setDetected([]);
  };

  const getFullUrl = (draft: DraftProxyServer) =>
    mergeAuth(draft.baseUrl, draft.username, draft.password);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {t("settings.globalProxy.hint")}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={scanMutation.isPending}
            onClick={handleScan}
          >
            {scanMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            {t("settings.globalProxy.scan")}
          </Button>
          <Button size="sm" onClick={handleAdd}>
            <Plus className="mr-2 h-4 w-4" />
            {t("settings.globalProxy.add", { defaultValue: "新增代理服务器" })}
          </Button>
        </div>
      </div>

      {detected.length > 0 && (
        <div className="flex flex-wrap gap-2 rounded-md border p-3">
          {detected.map((proxy) => (
            <Button
              key={proxy.url}
              variant="secondary"
              size="sm"
              onClick={() => handleSelectDetected(proxy.url)}
              className="font-mono text-xs"
            >
              {proxy.url}
            </Button>
          ))}
        </div>
      )}

      {drafts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          {t("settings.globalProxy.empty", {
            defaultValue: "尚未配置代理服务器，点击右上角新增即可创建。",
          })}
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map((draft) => {
            const fullUrl = getFullUrl(draft);
            const isDirty = dirtyIdSet.has(draft.id);
            return (
              <div key={draft.id} className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {draft.name.trim() ||
                        t("settings.globalProxy.unnamed", {
                          defaultValue: "未命名代理服务器",
                        })}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!fullUrl || testMutation.isPending}
                      onClick={() => handleTest(draft)}
                    >
                      <TestTube2 className="mr-2 h-4 w-4" />
                      {t("settings.globalProxy.test")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={!isDirty || saveMutation.isPending}
                      onClick={() => handleSave(draft)}
                    >
                      {saveMutation.isPending && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {t("common.save")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={deleteMutation.isPending}
                      onClick={() => handleDelete(draft)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t("common.delete", { defaultValue: "删除" })}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>
                      {t("settings.globalProxy.name", { defaultValue: "名称" })}
                    </Label>
                    <Input
                      value={draft.name}
                      onChange={(e) =>
                        updateDraft(draft.id, (item) => ({
                          ...item,
                          name: e.target.value,
                        }))
                      }
                      placeholder={t("settings.globalProxy.namePlaceholder", {
                        defaultValue: "例如：公司代理",
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>
                      {t("settings.globalProxy.url", {
                        defaultValue: "代理地址",
                      })}
                    </Label>
                    <Input
                      value={draft.baseUrl}
                      onChange={(e) =>
                        updateDraft(draft.id, (item) => ({
                          ...item,
                          baseUrl: e.target.value,
                        }))
                      }
                      placeholder="http://127.0.0.1:7890 / socks5://127.0.0.1:1080"
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>
                      {t("settings.globalProxy.username", {
                        defaultValue: "用户名（可选）",
                      })}
                    </Label>
                    <Input
                      value={draft.username}
                      onChange={(e) =>
                        updateDraft(draft.id, (item) => ({
                          ...item,
                          username: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>
                      {t("settings.globalProxy.password", {
                        defaultValue: "密码（可选）",
                      })}
                    </Label>
                    <Input
                      type="password"
                      value={draft.password}
                      onChange={(e) =>
                        updateDraft(draft.id, (item) => ({
                          ...item,
                          password: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
