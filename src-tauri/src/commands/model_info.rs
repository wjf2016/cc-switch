use crate::services::model_info::{self, ModelInfo};
use crate::store::AppState;
use tauri::State;

#[tauri::command(rename_all = "camelCase")]
pub async fn get_model_info(
    state: State<'_, AppState>,
    model_id: String,
) -> Result<Vec<ModelInfo>, String> {
    model_info::get_model_info(&state.db, &model_id)
        .await
        .map_err(|error| error.to_string())
}
