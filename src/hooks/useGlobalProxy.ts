/**
 * 全局出站代理 React Hooks
 *
 * 提供获取、设置和测试全局代理的 React Query hooks。
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  getProxyServers,
  saveProxyServers,
  deleteProxyServer,
  testProxyUrl,
  scanLocalProxies,
  type DeleteProxyServerResult,
  type ProxyServer,
  type ProxyServerPayload,
  type ProxyTestResult,
  type DetectedProxy,
} from "@/lib/api/globalProxy";

export function useProxyServers() {
  return useQuery({
    queryKey: ["proxyServers"],
    queryFn: getProxyServers,
    staleTime: 30 * 1000,
  });
}

export function useSaveProxyServers() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (proxyServers: ProxyServerPayload[]) =>
      saveProxyServers(proxyServers),
    onSuccess: () => {
      toast.success(t("settings.globalProxy.saved"));
      queryClient.invalidateQueries({ queryKey: ["proxyServers"] });
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Unknown error";
      toast.error(t("settings.globalProxy.saveFailed", { error: message }));
    },
  });
}

export function useDeleteProxyServer() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (id: string) => deleteProxyServer(id),
    onSuccess: (result: DeleteProxyServerResult) => {
      queryClient.invalidateQueries({ queryKey: ["proxyServers"] });
      if (result.affectedProviders > 0) {
        toast.success(
          t("settings.globalProxy.deletedWithFallback", {
            count: result.affectedProviders,
            defaultValue:
              "代理服务器已删除，{{count}} 个供应商已自动回退为直连",
          }),
        );
      } else {
        toast.success(
          t("settings.globalProxy.deleted", {
            defaultValue: "代理服务器已删除",
          }),
        );
      }
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Unknown error";
      toast.error(
        t("settings.globalProxy.deleteFailed", {
          error: message,
          defaultValue: "删除代理服务器失败：{{error}}",
        }),
      );
    },
  });
}

/**
 * 测试代理连接
 */
export function useTestProxy() {
  const { t } = useTranslation();

  return useMutation({
    mutationFn: testProxyUrl,
    onSuccess: (result: ProxyTestResult) => {
      if (result.success) {
        toast.success(
          t("settings.globalProxy.testSuccess", { latency: result.latencyMs }),
        );
      } else {
        toast.error(
          t("settings.globalProxy.testFailed", { error: result.error }),
        );
      }
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

export function useScanProxies() {
  const { t } = useTranslation();

  return useMutation({
    mutationFn: scanLocalProxies,
    onError: (error: Error) => {
      toast.error(
        t("settings.globalProxy.scanFailed", { error: error.message }),
      );
    },
  });
}

export type { DetectedProxy, ProxyServer };
