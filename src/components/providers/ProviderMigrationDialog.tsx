import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ProviderForm, type ProviderFormValues } from "@/components/providers/forms/ProviderForm";
import {
  providerMigrationApi,
  type ClaudeProviderMigrationSource,
  type ProviderMigrationEdit,
  type ProviderMigrationOutcome,
  type ProviderMigrationPreviewItem,
  type ProviderMigrationTargetApp,
} from "@/lib/api/providerMigration";

type Step = "select" | "edit" | "result";

export interface ProviderMigrationDialogProps {
  open: boolean;
  targetApp: ProviderMigrationTargetApp;
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => Promise<void> | void;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sourceLabel(source: ClaudeProviderMigrationSource): string {
  return source.baseUrl || source.id;
}

function outcomeItems(
  succeeded: ProviderMigrationOutcome[],
  failed: ProviderMigrationOutcome[],
  skipped: ProviderMigrationOutcome[],
): ProviderMigrationOutcome[] {
  return [...succeeded, ...failed, ...skipped];
}

function migrationSettings(item: ProviderMigrationPreviewItem): Record<string, unknown> {
  return { ...asRecord(item.settingsConfig) };
}

function modelFromCodexConfig(config: unknown): string {
  if (typeof config !== "string") return "";
  const match = config.match(/^model\s*=\s*"([^"]+)"/m);
  return match ? match[1] : "";
}

export function ProviderMigrationDialog({
  open,
  targetApp,
  onOpenChange,
  onCompleted,
}: ProviderMigrationDialogProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("select");
  const [sources, setSources] = useState<ClaudeProviderMigrationSource[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentItem, setCurrentItem] = useState<ProviderMigrationPreviewItem | null>(null);
  const [addToLive, setAddToLive] = useState(true);
  const [results, setResults] = useState<ProviderMigrationOutcome[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("select");
    setSources([]);
    setSelected([]);
    setQuery("");
    setCurrentIndex(0);
    setCurrentItem(null);
    setAddToLive(true);
    setResults([]);
    setError(null);
    setLoading(true);
    providerMigrationApi
      .getClaudeProviders()
      .then(setSources)
      .catch((reason: unknown) => {
        setSources([]);
        setError(reason instanceof Error ? reason.message : t("providerMigration.errors.loadSources"));
      })
      .finally(() => setLoading(false));
  }, [open, targetApp]);

  const visibleSources = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return sources.filter((source) => {
      if (!keyword) return true;
      return (
        source.name.toLowerCase().includes(keyword) ||
        source.id.toLowerCase().includes(keyword) ||
        sourceLabel(source).toLowerCase().includes(keyword)
      );
    });
  }, [sources, query]);

  const selectableSources = visibleSources.filter((source) => source.eligible);
  const allVisibleSelected =
    selectableSources.length > 0 &&
    selectableSources.every((source) => selected.includes(source.id));

  const toggleSource = (id: string, checked: boolean) => {
    setSelected((current) => {
      if (checked) return Array.from(new Set([...current, id]));
      return current.filter((value) => value !== id);
    });
  };

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setSelected((current) =>
        Array.from(new Set([...current, ...selectableSources.map((source) => source.id)])),
      );
      return;
    }
    const visibleIds = new Set(selectableSources.map((source) => source.id));
    setSelected((current) => current.filter((id) => !visibleIds.has(id)));
  };

  const loadItem = async (index: number) => {
    const sourceId = selected[index];
    if (!sourceId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await providerMigrationApi.preview({
        targetApp,
        providerIds: [sourceId],
      });
      const item = response.items[0];
      if (!item) throw new Error(t("providerMigration.errors.noItem"));
      setCurrentIndex(index);
      setCurrentItem(item);
      setStep("edit");
      if (response.warnings.length > 0) setError(response.warnings.join(t("providerMigration.separator")));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t("providerMigration.errors.loadItem"));
    } finally {
      setLoading(false);
    }
  };

  const startImport = () => {
    if (selected.length > 0) void loadItem(0);
  };

  const saveCurrent = async (values: ProviderFormValues) => {
    if (!currentItem) return;
    const settings = asRecord(JSON.parse(values.settingsConfig));
    const edits: ProviderMigrationEdit = {
      targetId: values.providerKey,
      name: values.name,
      baseUrl: typeof settings.baseUrl === "string" ? settings.baseUrl : "",
      api: typeof settings.api === "string" ? settings.api : undefined,
      apiKey:
        typeof settings.apiKey === "string"
          ? settings.apiKey
          : typeof asRecord(settings.auth).OPENAI_API_KEY === "string"
            ? (asRecord(settings.auth).OPENAI_API_KEY as string)
            : undefined,
    };
    if (targetApp === "pi") {
      edits.models = Array.isArray(settings.models)
        ? (settings.models as Array<string | Record<string, unknown>>)
        : [];
    } else {
      edits.model = modelFromCodexConfig(settings.config);
    }

    setError(null);
    const response = await providerMigrationApi.submit({
      targetApp,
      providerIds: [currentItem.sourceId],
      edits: { [currentItem.sourceId]: edits },
      addToLive: targetApp === "pi" ? addToLive : undefined,
    });
    const outcome = outcomeItems(
      response.succeeded,
      response.failed,
      response.skipped,
    )[0];
    if (!outcome) throw new Error(t("providerMigration.errors.noResult"));
    setResults((current) => [...current, outcome]);
    if (outcome.status !== "succeeded") {
      setError(outcome.reason || t("providerMigration.errors.retry"));
      return;
    }
    await onCompleted?.();
    if (currentIndex + 1 < selected.length) {
      await loadItem(currentIndex + 1);
    } else {
      setStep("result");
    }
  };

  const source = currentItem
    ? sources.find((item) => item.id === currentItem.sourceId)
    : undefined;
  const initialSettings = currentItem ? migrationSettings(currentItem) : {};
  const initialData = currentItem
    ? {
        name: currentItem.targetName,
        settingsConfig: initialSettings,
        category: "custom" as const,
        icon: targetApp === "pi" ? "pi" : "openai",
      }
    : undefined;

  const footer =
    step === "select" ? (
      <>
        <span className="mr-auto text-xs text-muted-foreground">{t("providerMigration.securityHint")}</span>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>{t("common.cancel")}</Button>
        <Button onClick={startImport} disabled={loading || selected.length === 0}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}{t("providerMigration.actions.startImport")} <ChevronRight className="h-4 w-4" />
        </Button>
      </>
    ) : step === "edit" ? (
      <>
        <Button variant="outline" onClick={() => setStep("select")} disabled={loading}><ChevronLeft className="h-4 w-4" />{t("providerMigration.actions.backToList")}</Button>
        <span className="mr-auto text-xs text-muted-foreground">{t("providerMigration.progress", { current: currentIndex + 1, total: selected.length })}</span>
        <Button type="submit" form="provider-form" disabled={loading || !currentItem}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}{t("providerMigration.actions.saveAndImport")} <ChevronRight className="h-4 w-4" />
        </Button>
      </>
    ) : (
      <Button onClick={() => onOpenChange(false)} disabled={loading}>{t("common.done")}</Button>
    );

  return (
    <FullScreenPanel
      isOpen={open}
      title={targetApp === "pi" ? t("providerMigration.titlePi") : t("providerMigration.titleCodex")}
      onClose={() => {
        if (!loading) onOpenChange(false);
      }}
      footer={footer}
      contentClassName="pt-4"
    >
      {error && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{error}</div>}

      {step === "select" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">{t("providerMigration.selectHint")}</div>
          <div className="flex gap-2">
            <div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("providerMigration.searchPlaceholder")} /></div>
            <Button variant="outline" onClick={() => toggleAll(!allVisibleSelected)} disabled={selectableSources.length === 0}>{allVisibleSelected ? t("providerMigration.actions.deselectAll") : t("providerMigration.actions.selectAll")}</Button>
          </div>
          <div className="divide-y divide-border-default rounded-lg border border-border-default">
            {loading ? <div className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />{t("providerMigration.loadingSources")}</div> : visibleSources.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">{t("providerMigration.noSources")}</div> : visibleSources.map((item) => <label key={item.id} className={`flex items-center gap-3 p-3 ${item.eligible ? "cursor-pointer hover:bg-muted/40" : "cursor-not-allowed opacity-60"}`}><Checkbox checked={selected.includes(item.id)} disabled={!item.eligible} onCheckedChange={(checked) => toggleSource(item.id, checked === true)} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.name}</span><span className="block truncate text-xs text-muted-foreground">{sourceLabel(item)}</span>{!item.eligible && item.reason && <span className="block text-xs text-amber-600">{t("providerMigration.ineligible", { reason: item.reason })}</span>}</span></label>)}
          </div>
          <p className="text-xs text-muted-foreground">{t("providerMigration.selectedCount", { count: selected.length })}</p>
        </div>
      )}

      {step === "edit" && currentItem && initialData && (
        <div className="space-y-4">
          <div className="flex items-start justify-between border-b border-border-default pb-4"><div><p className="text-xs text-muted-foreground">{t("providerMigration.editingProgress", { current: currentIndex + 1, total: selected.length })}</p><h2 className="mt-1 text-xl font-semibold">{currentItem.sourceName}</h2><p className="mt-1 text-sm text-muted-foreground">{t("providerMigration.sourceAddress", { address: source ? sourceLabel(source) : currentItem.sourceId })}</p></div><span className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700">{t("providerMigration.saveHint")}</span></div>
          <ProviderForm
            key={`${currentItem.sourceId}-${currentIndex}`}
            appId={targetApp}
            providerId={currentItem.targetId}
            submitLabel={t("providerMigration.actions.saveAndImport")}
            onSubmit={saveCurrent}
            onCancel={() => setStep("select")}
            initialData={initialData}
            showButtons={false}
            allowProviderKeyEdit={targetApp === "pi"}
            onSubmittingChange={setLoading}
          />
        </div>
      )}

      {step === "result" && <div className="space-y-4"><div className="rounded-lg border border-border-default bg-muted/40 p-4 text-sm text-foreground"><Check className="mr-2 inline h-4 w-4" />{t("providerMigration.resultSummary")}</div>{results.map((item) => <div key={`${item.sourceId}-${item.targetId}`} className="flex items-center justify-between gap-4 rounded-md border border-border-default p-3 text-sm"><span>{item.targetId}</span><span className={`text-right ${item.status === "succeeded" ? "text-emerald-600" : "text-red-600"}`}>{item.status === "succeeded" ? t("providerMigration.status.succeeded") : item.status === "blocked" ? t("providerMigration.status.blocked") : t("providerMigration.status.failed")}{item.reason ? ` · ${item.reason}` : ""}</span></div>)}</div>}
    </FullScreenPanel>
  );
}
