import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProxyServer } from "@/hooks/useGlobalProxy";

const DIRECT_CONNECTION_VALUE = "__direct_connection__";

interface ProviderProxySelectorProps {
  isLoading: boolean;
  proxyServers: ProxyServer[];
  value: string;
  onChange: (value: string) => void;
  onOpenProxySettings?: () => void;
}

function maskProxyUrl(url: string): string {
  if (!url.trim()) return "";

  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function buildProxyOptionLabel(proxyServer: ProxyServer): string {
  const safeUrl = maskProxyUrl(proxyServer.url).trim();
  if (!safeUrl) return proxyServer.name;
  return `${proxyServer.name} (${safeUrl})`;
}

export function ProviderProxySelector({
  isLoading,
  proxyServers,
  value,
  onChange,
  onOpenProxySettings,
}: ProviderProxySelectorProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      <Label>{t("provider.proxyServer", { defaultValue: "代理服务器" })}</Label>

      {isLoading ? (
        <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {t("common.loading", { defaultValue: "加载中..." })}
        </div>
      ) : proxyServers.length > 0 ? (
        <>
          <Select
            value={value || DIRECT_CONNECTION_VALUE}
            onValueChange={(nextValue) =>
              onChange(nextValue === DIRECT_CONNECTION_VALUE ? "" : nextValue)
            }
          >
            <SelectTrigger>
              <SelectValue
                placeholder={t("provider.proxyDirect", {
                  defaultValue: "直连（不使用代理）",
                })}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DIRECT_CONNECTION_VALUE}>
                {t("provider.proxyDirect", {
                  defaultValue: "直连（不使用代理）",
                })}
              </SelectItem>
              {proxyServers.map((proxyServer) => (
                <SelectItem key={proxyServer.id} value={proxyServer.id}>
                  {buildProxyOptionLabel(proxyServer)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t("provider.proxyHint", {
              defaultValue:
                "选择后仅当前供应商通过该代理访问；不选择则保持直连。",
            })}
          </p>
        </>
      ) : (
        <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          <p>
            {t("provider.proxyPoolEmpty", {
              defaultValue: "未配置代理服务器，当前供应商将保持直连。",
            })}
          </p>
          {onOpenProxySettings ? (
            <Button
              type="button"
              variant="link"
              className="mt-1 h-auto p-0"
              onClick={onOpenProxySettings}
            >
              {t("provider.proxyOpenSettings", {
                defaultValue: "去配置代理服务器",
              })}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
