//! models.dev 模型信息查询

use crate::database::Database;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

const MODELS_DEV_MODELS_URL: &str = "https://models.dev/models.json";
const CACHE_KEY: &str = "models_dev_models_cache_v1";
const CACHE_TTL_SECONDS: i64 = 60 * 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub model_id: String,
    pub name: String,
    pub context: u64,
    pub output: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct ModelInfoCache {
    fetched_at: i64,
    models: BTreeMap<String, Value>,
}

fn now_seconds() -> Result<i64, AppError> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::Message(error.to_string()))?
        .as_secs() as i64)
}

fn normalize_model_id(value: &str) -> String {
    value
        .rsplit('/')
        .next()
        .unwrap_or(value)
        .trim()
        .to_lowercase()
}

fn parse_matches(models: &BTreeMap<String, Value>, query: &str) -> Vec<ModelInfo> {
    let normalized_query = normalize_model_id(query);
    let mut matches = models
        .iter()
        .filter_map(|(key, value)| {
            let model = value.as_object()?;
            let model_id = model.get("id").and_then(Value::as_str).unwrap_or(key);
            if normalize_model_id(key) != normalized_query
                && normalize_model_id(model_id) != normalized_query
            {
                return None;
            }
            let name = model.get("name").and_then(Value::as_str)?;
            let limit = model.get("limit")?.as_object()?;
            let context = limit.get("context")?.as_u64()?;
            let output = limit.get("output")?.as_u64()?;
            Some(ModelInfo {
                model_id: key.clone(),
                name: name.to_string(),
                context,
                output,
            })
        })
        .collect::<Vec<_>>();
    matches.sort_by(|left, right| left.model_id.cmp(&right.model_id));
    matches
}

async fn load_models(db: &Database) -> Result<BTreeMap<String, Value>, AppError> {
    let now = now_seconds()?;
    if let Some(raw) = db.get_setting(CACHE_KEY)? {
        if let Ok(cache) = serde_json::from_str::<ModelInfoCache>(&raw) {
            if now - cache.fetched_at < CACHE_TTL_SECONDS {
                return Ok(cache.models);
            }
        }
    }

    let response = crate::proxy::http_client::get()
        .get(MODELS_DEV_MODELS_URL)
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|error| AppError::Message(format!("请求 models.dev 失败: {error}")))?;
    if !response.status().is_success() {
        return Err(AppError::Message(format!(
            "请求 models.dev 失败: HTTP {}",
            response.status()
        )));
    }
    let models = response
        .json::<BTreeMap<String, Value>>()
        .await
        .map_err(|error| AppError::Message(format!("解析 models.dev 数据失败: {error}")))?;
    let cache = ModelInfoCache {
        fetched_at: now,
        models: models.clone(),
    };
    db.set_setting(
        CACHE_KEY,
        &serde_json::to_string(&cache)
            .map_err(|error| AppError::Message(format!("保存 models.dev 缓存失败: {error}")))?,
    )?;
    Ok(models)
}

pub async fn get_model_info(db: &Database, model_id: &str) -> Result<Vec<ModelInfo>, AppError> {
    if normalize_model_id(model_id).is_empty() {
        return Ok(Vec::new());
    }
    Ok(parse_matches(&load_models(db).await?, model_id))
}

#[cfg(test)]
mod tests {
    use super::{normalize_model_id, parse_matches};
    use serde_json::json;
    use std::collections::BTreeMap;

    #[test]
    fn matches_case_insensitively_after_provider_prefix() {
        let mut models = BTreeMap::new();
        models.insert(
            "anthropic/Claude-3-7-Sonnet".to_string(),
            json!({"id":"claude-3-7-sonnet","name":"Claude 3.7 Sonnet","limit":{"context":200000,"output":8192}}),
        );
        let matches = parse_matches(&models, "OpenRouter/CLAUDE-3-7-SONNET");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].context, 200000);
    }

    #[test]
    fn normalizes_only_the_last_provider_prefix() {
        assert_eq!(normalize_model_id("a/b/C"), "c");
    }
}
