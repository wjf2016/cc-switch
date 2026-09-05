//! Claude Code provider migration to native Pi and Codex providers.
//!
//! This module deliberately uses the Claude provider rows in the database as
//! its source of truth. It never reads Claude's live files; preview responses
//! include the credential because migration editing is explicitly allowed to
//! change it, while submit keeps it in memory only long enough for
//! `ProviderService::add` to persist the target provider.

use crate::app_config::AppType;
use crate::error::AppError;
use crate::provider::Provider;
use crate::store::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashSet;

const DEFAULT_CLAUDE_BASE_URL: &str = "https://api.anthropic.com";
const DEFAULT_CLAUDE_MODEL: &str = "claude-sonnet-4-5";
const REDACTED_KEY: &str = "[REDACTED]";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeProviderMigrationRequest {
    #[serde(alias = "target")]
    pub target_app: String,
    #[serde(default, alias = "sourceIds")]
    pub provider_ids: Vec<String>,
    /// Source-ID keyed edits. Each value may set targetId, name, baseUrl, api,
    /// apiKey, model or models. `overrides` remains an input alias for the initial API.
    #[serde(default, alias = "overrides")]
    pub edits: Option<Value>,
    #[serde(default)]
    pub defaults: Option<Value>,
    /// Pi 可以选择只保存到 CC Switch 数据库；Codex 始终沿用现有 add 语义。
    #[serde(default)]
    pub add_to_live: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeProviderMigrationSource {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    pub eligible: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeProviderMigrationPreview {
    pub target: String,
    pub items: Vec<ClaudeProviderMigrationItem>,
    pub conflicts: Vec<String>,
    pub warnings: Vec<String>,
    pub blocked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeProviderMigrationItem {
    pub source_id: String,
    pub source_name: String,
    pub target_id: String,
    pub target_name: String,
    pub settings_config: Value,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeProviderMigrationSubmitResult {
    pub target: String,
    pub succeeded: Vec<ClaudeProviderMigrationOutcome>,
    pub failed: Vec<ClaudeProviderMigrationOutcome>,
    pub skipped: Vec<ClaudeProviderMigrationOutcome>,
    pub blocked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeProviderMigrationOutcome {
    pub source_id: String,
    pub target_id: String,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MigrationTarget {
    Pi,
    Codex,
}

impl MigrationTarget {
    fn parse(value: &str) -> Result<Self, AppError> {
        match value.trim().to_ascii_lowercase().as_str() {
            "pi" => Ok(Self::Pi),
            "codex" => Ok(Self::Codex),
            other => Err(AppError::InvalidInput(format!(
                "不支持的迁移目标 '{other}'，可选值为 pi 或 codex"
            ))),
        }
    }

    fn app_type(self) -> AppType {
        match self {
            Self::Pi => AppType::Pi,
            Self::Codex => AppType::Codex,
        }
    }
}

#[derive(Debug, Clone)]
struct PreparedItem {
    source_id: String,
    source_name: String,
    target_id: String,
    target_name: String,
    provider: Provider,
    validation_error: Option<String>,
}

#[derive(Debug, Clone)]
struct SourceCredentials {
    api_key: String,
    base_url: String,
    models: Vec<String>,
}

pub fn list_sources(state: &AppState) -> Result<Vec<ClaudeProviderMigrationSource>, AppError> {
    let providers = state.db.get_all_providers(AppType::Claude.as_str())?;
    Ok(providers
        .values()
        .map(|provider| match source_credentials(provider) {
            Ok(credentials) => ClaudeProviderMigrationSource {
                id: provider.id.clone(),
                name: provider.name.clone(),
                base_url: Some(credentials.base_url),
                eligible: true,
                reason: None,
                api_key: REDACTED_KEY.to_string(),
            },
            Err(reason) => ClaudeProviderMigrationSource {
                id: provider.id.clone(),
                name: provider.name.clone(),
                base_url: source_base_url(provider),
                eligible: false,
                reason: Some(reason),
                api_key: REDACTED_KEY.to_string(),
            },
        })
        .collect())
}

/// Re-read the requested Claude provider IDs from the DB and produce a safe
/// preview. Empty `providerIds` means all Claude DB rows, which is useful for a
/// first-run "migrate all" action and remains deterministic due to DB ordering.
pub fn preview(
    state: &AppState,
    request: &ClaudeProviderMigrationRequest,
) -> Result<ClaudeProviderMigrationPreview, AppError> {
    let target = MigrationTarget::parse(&request.target_app)?;
    let (prepared, mut warnings) = prepare_items(state, request, target)?;
    let conflicts = target_conflicts(state, target, &prepared)?;
    let conflict_ids: HashSet<&str> = conflicts.iter().map(String::as_str).collect();
    let mut items = Vec::with_capacity(prepared.len());

    for item in prepared {
        let has_conflict = conflict_ids.contains(item.target_id.as_str());
        let is_invalid = item.validation_error.is_some();
        let settings_config = item.provider.settings_config.clone();
        let reason = if has_conflict {
            Some("目标供应商 ID 已存在".to_string())
        } else {
            item.validation_error.clone()
        };
        items.push(ClaudeProviderMigrationItem {
            source_id: item.source_id,
            source_name: item.source_name,
            target_id: item.target_id,
            target_name: item.target_name,
            settings_config,
            status: if has_conflict || is_invalid {
                "blocked".to_string()
            } else {
                "ready".to_string()
            },
            reason,
        });
    }

    if !conflicts.is_empty() {
        warnings.push("存在目标 ID 冲突，冲突项不会提交".to_string());
    }
    if items.iter().any(|item| item.status == "blocked") {
        warnings.push("存在字段不完整或不兼容的供应商，补充后可重新预览".to_string());
    }
    Ok(ClaudeProviderMigrationPreview {
        target: request.target_app.trim().to_string(),
        blocked: !conflicts.is_empty() || items.iter().any(|item| item.status == "blocked"),
        items,
        conflicts,
        warnings,
    })
}

/// Convert and submit each non-conflicting item independently. A failed item
/// does not roll back earlier successful `ProviderService::add` calls.
pub fn submit(
    state: &AppState,
    request: &ClaudeProviderMigrationRequest,
) -> Result<ClaudeProviderMigrationSubmitResult, AppError> {
    let target = MigrationTarget::parse(&request.target_app)?;
    if target == MigrationTarget::Codex && request.add_to_live.is_some() {
        return Err(AppError::InvalidInput(
            "addToLive 仅适用于 Pi 迁移".to_string(),
        ));
    }
    let (prepared, _) = prepare_items(state, request, target)?;
    let conflicts = target_conflicts(state, target, &prepared)?;
    let conflict_ids: HashSet<&str> = conflicts.iter().map(String::as_str).collect();
    let mut result = ClaudeProviderMigrationSubmitResult {
        target: request.target_app.trim().to_string(),
        succeeded: Vec::new(),
        failed: Vec::new(),
        skipped: Vec::new(),
        blocked: !conflicts.is_empty(),
    };

    for item in prepared {
        let has_conflict = conflict_ids.contains(item.target_id.as_str());
        if has_conflict || item.validation_error.is_some() {
            result.skipped.push(ClaudeProviderMigrationOutcome {
                source_id: item.source_id,
                target_id: item.target_id,
                status: "blocked".to_string(),
                reason: if has_conflict {
                    Some("目标供应商 ID 已存在".to_string())
                } else {
                    item.validation_error
                },
            });
            continue;
        }

        let add_to_live = target != MigrationTarget::Pi || request.add_to_live.unwrap_or(true);
        match crate::services::provider::ProviderService::add(
            state,
            target.app_type(),
            item.provider,
            add_to_live,
        ) {
            Ok(_) => result.succeeded.push(ClaudeProviderMigrationOutcome {
                source_id: item.source_id,
                target_id: item.target_id,
                status: "succeeded".to_string(),
                reason: None,
            }),
            Err(error) => result.failed.push(ClaudeProviderMigrationOutcome {
                source_id: item.source_id,
                target_id: item.target_id,
                status: "failed".to_string(),
                reason: Some(error.to_string()),
            }),
        }
    }
    Ok(result)
}

fn prepare_items(
    state: &AppState,
    request: &ClaudeProviderMigrationRequest,
    target: MigrationTarget,
) -> Result<(Vec<PreparedItem>, Vec<String>), AppError> {
    let providers = state.db.get_all_providers(AppType::Claude.as_str())?;
    let selected_ids = requested_ids(request, &providers);
    let mut prepared = Vec::new();
    let mut warnings = Vec::new();

    for source_id in selected_ids {
        let Some(source) = providers.get(&source_id) else {
            warnings.push(format!("Claude provider '{source_id}' 不存在，已跳过"));
            continue;
        };

        let credentials = match source_credentials(source) {
            Ok(value) => value,
            Err(reason) => {
                warnings.push(format!("Claude provider '{}' 已跳过：{reason}", source.id));
                continue;
            }
        };
        let override_value = source_override(request.edits.as_ref(), &source.id);
        let defaults = request.defaults.as_ref();
        let target_id = string_override(override_value.as_ref(), "targetId")
            .or_else(|| string_override(override_value.as_ref(), "id"))
            .unwrap_or_else(|| source.id.clone());
        if target_id.trim().is_empty() {
            warnings.push(format!(
                "Claude provider '{}' 的 targetId 为空，已跳过",
                source.id
            ));
            continue;
        }
        let api_key = match override_value
            .as_ref()
            .and_then(Value::as_object)
            .and_then(|object| object.get("apiKey"))
        {
            Some(value) => value
                .as_str()
                .map(str::trim)
                .filter(|value| is_explicit_key(value))
                .map(str::to_string)
                .ok_or_else(|| AppError::InvalidInput("API key 不能为空".to_string()))?,
            None => credentials.api_key.clone(),
        };
        let target_name = string_override(override_value.as_ref(), "name")
            .or_else(|| string_override(defaults, "name"))
            .unwrap_or_else(|| source.name.clone());
        let base_url = string_override(override_value.as_ref(), "baseUrl")
            .or_else(|| string_override(defaults, "baseUrl"))
            .unwrap_or_else(|| credentials.base_url.clone());
        let model_values = model_values(override_value.as_ref(), defaults, &credentials.models);
        let validation_error = match target {
            MigrationTarget::Pi => validate_pi_migration_draft(&base_url, &model_values),
            MigrationTarget::Codex => {
                let api_format = source
                    .meta
                    .as_ref()
                    .and_then(|meta| meta.api_format.as_deref());
                if api_format == Some("gemini_native") {
                    Some("Gemini Native 上游无法自动迁移为 Codex Responses 端点".to_string())
                } else {
                    validate_codex_migration_draft(&base_url, &model_values)
                }
            }
        };
        let provider = match target {
            MigrationTarget::Pi => build_pi_provider(
                &target_id,
                &target_name,
                &base_url,
                &api_key,
                &model_values,
                override_value.as_ref(),
                defaults,
            ),
            MigrationTarget::Codex => {
                build_codex_provider(&target_id, &target_name, &base_url, &api_key, &model_values)?
            }
        };
        prepared.push(PreparedItem {
            source_id: source.id.clone(),
            source_name: source.name.clone(),
            target_id,
            target_name,
            provider,
            validation_error,
        });
    }
    Ok((prepared, warnings))
}

fn validate_pi_migration_draft(base_url: &str, models: &[Value]) -> Option<String> {
    if !is_http_url(base_url) {
        return Some("Pi 供应商需要有效的 http(s) Base URL".to_string());
    }
    if models.is_empty() {
        return Some("Pi 供应商至少需要一个模型".to_string());
    }
    for model in models {
        let Some(object) = model.as_object() else {
            return Some("Pi 模型必须是 JSON 对象".to_string());
        };
        if object
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
        {
            return Some("Pi 模型缺少 id".to_string());
        }
        if object
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
        {
            return Some("Pi 模型缺少 name".to_string());
        }
        for field in ["contextWindow", "maxTokens"] {
            if object
                .get(field)
                .and_then(Value::as_u64)
                .filter(|value| *value > 0)
                .is_none()
            {
                return Some(format!("Pi 模型缺少有效的 {field}"));
            }
        }
    }
    None
}

fn validate_codex_migration_draft(base_url: &str, models: &[Value]) -> Option<String> {
    if !is_http_url(base_url) {
        return Some("Codex 供应商需要有效的 http(s) Base URL".to_string());
    }
    let model = models
        .iter()
        .find_map(|value| value.get("id").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if model.is_none() {
        return Some("Codex 供应商需要选择一个模型".to_string());
    }
    None
}

fn is_http_url(value: &str) -> bool {
    let value = value.trim().to_ascii_lowercase();
    value.starts_with("https://") || value.starts_with("http://")
}

fn requested_ids(
    request: &ClaudeProviderMigrationRequest,
    providers: &indexmap::IndexMap<String, Provider>,
) -> Vec<String> {
    if request.provider_ids.is_empty() {
        return providers.keys().cloned().collect();
    }
    let mut seen = HashSet::new();
    request
        .provider_ids
        .iter()
        .map(|id| id.trim())
        .filter(|id| !id.is_empty())
        .filter(|id| seen.insert((*id).to_string()))
        .map(str::to_string)
        .collect()
}

fn source_base_url(provider: &Provider) -> Option<String> {
    provider
        .settings_config
        .pointer("/env/ANTHROPIC_BASE_URL")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_end_matches('/').to_string())
}

fn source_credentials(provider: &Provider) -> Result<SourceCredentials, String> {
    if provider.uses_managed_account_auth()
        || provider.is_github_copilot()
        || provider.is_codex_oauth()
    {
        return Err("托管/OAuth/Copilot 供应商不支持批量迁移".to_string());
    }
    if provider
        .meta
        .as_ref()
        .and_then(|meta| meta.provider_type.as_deref())
        .map(|kind| {
            let kind = kind.to_ascii_lowercase();
            kind.contains("oauth") || kind.contains("copilot") || kind.contains("managed")
        })
        .unwrap_or(false)
    {
        return Err("托管/OAuth/Copilot 供应商不支持批量迁移".to_string());
    }

    let env = provider
        .settings_config
        .get("env")
        .and_then(Value::as_object)
        .ok_or_else(|| "缺少 Claude env 配置".to_string())?;
    let preferred_key = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.api_key_field.as_deref())
        .unwrap_or("ANTHROPIC_AUTH_TOKEN");
    let fallback_key = if preferred_key == "ANTHROPIC_API_KEY" {
        "ANTHROPIC_AUTH_TOKEN"
    } else {
        "ANTHROPIC_API_KEY"
    };
    let preferred_value = env
        .get(preferred_key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|key| is_explicit_key(key));
    let fallback_value = env
        .get(fallback_key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|key| is_explicit_key(key));
    let has_explicit_field = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.api_key_field.as_deref())
        .is_some();
    let api_key = if has_explicit_field && preferred_value.is_none() && fallback_value.is_some() {
        return Err("指定的 Claude 认证字段为空，无法安全迁移到另一认证字段".to_string());
    } else {
        preferred_value
            .or(fallback_value)
            .map(str::to_string)
            .ok_or_else(|| "缺少明确的普通 API key".to_string())?
    };
    let base_url = env
        .get("ANTHROPIC_BASE_URL")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_CLAUDE_BASE_URL)
        .trim_end_matches('/')
        .to_string();
    let models = [
        "ANTHROPIC_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    ]
    .iter()
    .filter_map(|key| env.get(*key).and_then(Value::as_str))
    .map(str::trim)
    .filter(|model| !model.is_empty() && !model.contains("${"))
    .map(strip_context_marker)
    .fold(Vec::new(), |mut models, model| {
        if !models.iter().any(|existing| existing == &model) {
            models.push(model);
        }
        models
    });
    Ok(SourceCredentials {
        api_key,
        base_url,
        models,
    })
}

fn is_explicit_key(value: &str) -> bool {
    !value.is_empty()
        && !value.contains("${")
        && !value.eq_ignore_ascii_case("请修改key")
        && !value.eq_ignore_ascii_case("[redacted]")
}

fn strip_context_marker(model: &str) -> String {
    let trimmed = model.trim();
    if trimmed.ends_with("[1M]") || trimmed.ends_with("[1m]") {
        trimmed[..trimmed.len() - 4].trim_end().to_string()
    } else {
        trimmed.to_string()
    }
}

fn source_override(edits: Option<&Value>, source_id: &str) -> Option<Value> {
    let object = edits.and_then(Value::as_object)?;
    if let Some(source_edit) = object.get(source_id).filter(|value| value.is_object()) {
        return Some(source_edit.clone());
    }
    let has_source_keyed_edits = object.values().any(Value::is_object);
    if has_source_keyed_edits {
        None
    } else {
        Some(Value::Object(object.clone()))
    }
}

fn string_override(value: Option<&Value>, key: &str) -> Option<String> {
    value
        .and_then(Value::as_object)
        .and_then(|object| object.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn model_values(
    override_value: Option<&Value>,
    defaults: Option<&Value>,
    source_models: &[String],
) -> Vec<Value> {
    if let Some(models) = override_value
        .and_then(Value::as_object)
        .and_then(|object| object.get("models"))
        .and_then(Value::as_array)
    {
        if !models.is_empty() {
            return models.clone();
        }
    }
    if let Some(model) = string_override(override_value, "model") {
        return vec![json!({ "id": model })];
    }
    if let Some(models) = defaults
        .and_then(Value::as_object)
        .and_then(|object| object.get("models"))
        .and_then(Value::as_array)
    {
        if !models.is_empty() {
            return models.clone();
        }
    }
    if let Some(model) = string_override(defaults, "model") {
        return vec![json!({ "id": model })];
    }
    if source_models.is_empty() {
        vec![json!({ "id": DEFAULT_CLAUDE_MODEL })]
    } else {
        source_models
            .iter()
            .map(|model| json!({ "id": model }))
            .collect()
    }
}

fn build_pi_provider(
    id: &str,
    name: &str,
    base_url: &str,
    api_key: &str,
    models: &[Value],
    override_value: Option<&Value>,
    defaults: Option<&Value>,
) -> Provider {
    let api = string_override(override_value, "api")
        .or_else(|| string_override(defaults, "api"))
        .unwrap_or_else(|| "anthropic-messages".to_string());
    let model_values = models
        .iter()
        .filter_map(normalize_pi_model)
        .collect::<Vec<_>>();
    let settings = json!({
        "name": name,
        "baseUrl": base_url.trim_end_matches('/'),
        "apiKey": api_key,
        "api": api,
        "models": model_values,
    });
    let mut provider = Provider::with_id(id.to_string(), name.to_string(), settings, None);
    provider.category = Some("custom".to_string());
    provider.icon = Some("pi".to_string());
    provider
}

fn normalize_pi_model(value: &Value) -> Option<Value> {
    if let Some(model) = value
        .as_str()
        .map(str::trim)
        .filter(|model| !model.is_empty())
    {
        return Some(json!({ "id": model }));
    }
    let object = value
        .as_object()?
        .iter()
        .fold(Map::new(), |mut output, (key, value)| {
            output.insert(key.clone(), value.clone());
            output
        });
    let id = object.get("id").and_then(Value::as_str)?.trim();
    if id.is_empty() {
        None
    } else {
        Some(Value::Object(object))
    }
}

fn build_codex_provider(
    id: &str,
    name: &str,
    base_url: &str,
    api_key: &str,
    models: &[Value],
) -> Result<Provider, AppError> {
    let model = models
        .iter()
        .find_map(|value| value.get("id").and_then(Value::as_str))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(DEFAULT_CLAUDE_MODEL);
    let quoted_name = toml_edit::Value::from(name).to_string();
    let quoted_model = toml_edit::Value::from(model).to_string();
    let quoted_base_url = toml_edit::Value::from(base_url.trim_end_matches('/')).to_string();
    let config = format!(
        "model_provider = \"custom\"\nmodel = {quoted_model}\n\n[model_providers.custom]\nname = {quoted_name}\nbase_url = {quoted_base_url}\nwire_api = \"responses\"\nrequires_openai_auth = true\n"
    );
    let settings = json!({
        "auth": { "OPENAI_API_KEY": api_key },
        "config": config,
    });
    let mut provider = Provider::with_id(id.to_string(), name.to_string(), settings, None);
    provider.category = Some("custom".to_string());
    provider.icon = Some("openai".to_string());
    Ok(provider)
}

fn target_conflicts(
    state: &AppState,
    target: MigrationTarget,
    items: &[PreparedItem],
) -> Result<Vec<String>, AppError> {
    let mut existing = HashSet::new();
    match target {
        MigrationTarget::Pi => {
            existing.extend(state.db.get_provider_ids(AppType::Pi.as_str())?);
            existing.extend(
                crate::pi_config::read_pi_native_providers()?
                    .keys()
                    .cloned(),
            );
        }
        MigrationTarget::Codex => {
            existing.extend(state.db.get_provider_ids(AppType::Codex.as_str())?);
        }
    }
    Ok(items
        .iter()
        .filter(|item| existing.contains(&item.target_id))
        .map(|item| item.target_id.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn source_settings(key: &str) -> Value {
        json!({
            "env": {
                "ANTHROPIC_API_KEY": key,
                "ANTHROPIC_BASE_URL": "https://relay.example/v1",
                "ANTHROPIC_MODEL": "model-a"
            }
        })
    }

    #[test]
    fn pi_conversion_has_native_shape_and_includes_key() {
        let provider = build_pi_provider(
            "p",
            "Provider",
            "https://relay.example/v1",
            "secret",
            &[json!({"id":"model-a","contextWindow":1000})],
            None,
            None,
        );
        let preview = provider.settings_config.clone();
        assert_eq!(preview["name"], "Provider");
        assert_eq!(preview["baseUrl"], "https://relay.example/v1");
        assert_eq!(preview["api"], "anthropic-messages");
        assert_eq!(preview["models"][0]["id"], "model-a");
        assert_eq!(preview["apiKey"], "secret");
        assert_eq!(provider.settings_config["apiKey"], "secret");
    }

    #[test]
    fn oauth_and_placeholder_keys_are_rejected() {
        let provider = Provider::with_id(
            "p".to_string(),
            "P".to_string(),
            source_settings("${TOKEN}"),
            None,
        );
        assert!(source_credentials(&provider).is_err());
        let provider = Provider::with_id(
            "p".to_string(),
            "P".to_string(),
            source_settings("请修改key"),
            None,
        );
        assert!(source_credentials(&provider).is_err());
    }

    #[test]
    fn codex_config_uses_responses_and_openai_auth() {
        let provider = build_codex_provider(
            "relay",
            "Relay",
            "https://relay.example/v1",
            "secret",
            &[json!({"id":"model-a"})],
        )
        .expect("build codex provider");
        assert_eq!(provider.settings_config["auth"]["OPENAI_API_KEY"], "secret");
        let config = provider.settings_config["config"]
            .as_str()
            .unwrap_or_default();
        assert!(config.contains("model_provider = \"custom\""));
        assert!(config.contains("[model_providers.custom]"));
        assert!(config.contains("wire_api = \"responses\""));
    }
}
