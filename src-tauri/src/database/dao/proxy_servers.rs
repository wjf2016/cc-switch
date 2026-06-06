use crate::database::{lock_conn, Database};
use crate::error::AppError;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProxyServer {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_index: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProxyServerResult {
    pub deleted: bool,
    pub affected_providers: i64,
}

impl Database {
    pub fn list_proxy_servers(&self) -> Result<Vec<ProxyServer>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT id, name, url, sort_index, created_at, updated_at
                 FROM proxy_servers
                 ORDER BY COALESCE(sort_index, 999999), created_at ASC, id ASC",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(ProxyServer {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    url: row.get(2)?,
                    sort_index: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut items = Vec::new();
        for item in rows {
            items.push(item.map_err(|e| AppError::Database(e.to_string()))?);
        }
        Ok(items)
    }

    pub fn get_proxy_server_by_id(&self, id: &str) -> Result<Option<ProxyServer>, AppError> {
        let conn = lock_conn!(self.conn);
        let result = conn.query_row(
            "SELECT id, name, url, sort_index, created_at, updated_at
             FROM proxy_servers
             WHERE id = ?1",
            params![id],
            |row| {
                Ok(ProxyServer {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    url: row.get(2)?,
                    sort_index: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        );

        match result {
            Ok(item) => Ok(Some(item)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn save_proxy_server(&self, proxy_server: &ProxyServer) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT INTO proxy_servers (id, name, url, sort_index, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 url = excluded.url,
                 sort_index = excluded.sort_index,
                 updated_at = excluded.updated_at",
            params![
                proxy_server.id,
                proxy_server.name.trim(),
                proxy_server.url.trim(),
                proxy_server.sort_index,
                proxy_server.created_at,
                proxy_server.updated_at,
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn get_proxy_server_by_url(&self, url: &str) -> Result<Option<ProxyServer>, AppError> {
        let conn = lock_conn!(self.conn);
        let result = conn.query_row(
            "SELECT id, name, url, sort_index, created_at, updated_at
             FROM proxy_servers
             WHERE url = ?1",
            params![url],
            |row| {
                Ok(ProxyServer {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    url: row.get(2)?,
                    sort_index: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        );

        match result {
            Ok(item) => Ok(Some(item)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn delete_proxy_server(&self, id: &str) -> Result<DeleteProxyServerResult, AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;

        let target = serde_json::to_string(id)
            .map_err(|e| AppError::Database(format!("Failed to serialize proxy id: {e}")))?;
        let affected_providers =
            tx.execute(
                "UPDATE providers
                 SET meta = json_remove(meta, '$.proxyServerId')
                 WHERE json_extract(meta, '$.proxyServerId') = json(?1)",
                params![target],
            )
            .map_err(|e| AppError::Database(e.to_string()))? as i64;

        let deleted = tx
            .execute("DELETE FROM proxy_servers WHERE id = ?1", params![id])
            .map_err(|e| AppError::Database(e.to_string()))?
            > 0;

        tx.commit().map_err(|e| AppError::Database(e.to_string()))?;

        Ok(DeleteProxyServerResult {
            deleted,
            affected_providers,
        })
    }
}
