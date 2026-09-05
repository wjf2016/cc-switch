use crate::services::provider::{
    ClaudeProviderMigrationPreview, ClaudeProviderMigrationRequest, ClaudeProviderMigrationSource,
    ClaudeProviderMigrationSubmitResult,
};
use crate::store::AppState;
use tauri::State;

/// Return a credential-safe list of Claude provider migration candidates.
/// The source database settings are deliberately never serialized to the
/// renderer; `apiKey` is always a redaction marker.
#[tauri::command]
pub fn get_claude_provider_migration_sources(
    state: State<'_, AppState>,
) -> Result<Vec<ClaudeProviderMigrationSource>, String> {
    crate::services::provider::migration::list_sources(state.inner())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn preview_provider_migration(
    state: State<'_, AppState>,
    request: ClaudeProviderMigrationRequest,
) -> Result<ClaudeProviderMigrationPreview, String> {
    crate::services::provider::migration::preview(state.inner(), &request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn submit_provider_migration(
    state: State<'_, AppState>,
    request: ClaudeProviderMigrationRequest,
) -> Result<ClaudeProviderMigrationSubmitResult, String> {
    crate::services::provider::migration::submit(state.inner(), &request)
        .map_err(|error| error.to_string())
}
