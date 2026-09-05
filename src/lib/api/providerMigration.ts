import { invoke } from "@tauri-apps/api/core";

export type ProviderMigrationTargetApp = "pi" | "codex";

export interface ClaudeProviderMigrationSource {
  id: string;
  name: string;
  baseUrl?: string;
  eligible: boolean;
  reason?: string;
  apiKey: string;
}

export interface ProviderMigrationEdit {
  targetId?: string;
  name?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  model?: string;
  models?: Array<string | Record<string, unknown>>;
}

export interface ProviderMigrationPreviewItem {
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  settingsConfig: Record<string, unknown>;
  status: "ready" | "blocked";
  reason?: string;
}

export interface ProviderMigrationPreviewResponse {
  target: ProviderMigrationTargetApp;
  items: ProviderMigrationPreviewItem[];
  conflicts: string[];
  warnings: string[];
  blocked: boolean;
}

export interface ProviderMigrationOutcome {
  sourceId: string;
  targetId: string;
  status: "succeeded" | "failed" | "blocked";
  reason?: string;
}

export interface ProviderMigrationSubmitResponse {
  target: ProviderMigrationTargetApp;
  succeeded: ProviderMigrationOutcome[];
  failed: ProviderMigrationOutcome[];
  skipped: ProviderMigrationOutcome[];
  blocked: boolean;
}

export interface ProviderMigrationRequest {
  targetApp: ProviderMigrationTargetApp;
  providerIds: string[];
  edits?: Record<string, ProviderMigrationEdit>;
  defaults?: Record<string, unknown>;
  addToLive?: boolean;
}

/** Read a credential-safe Claude provider catalog for the migration dialog. */
async function getClaudeProviders(): Promise<ClaudeProviderMigrationSource[]> {
  return await invoke("get_claude_provider_migration_sources");
}

async function preview(
  request: ProviderMigrationRequest,
): Promise<ProviderMigrationPreviewResponse> {
  return await invoke("preview_provider_migration", { request });
}

async function submit(
  request: ProviderMigrationRequest,
): Promise<ProviderMigrationSubmitResponse> {
  return await invoke("submit_provider_migration", { request });
}

export const providerMigrationApi = {
  getClaudeProviders,
  preview,
  submit,
};
