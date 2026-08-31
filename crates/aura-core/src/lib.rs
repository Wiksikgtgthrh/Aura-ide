//! aura-core — чистая бизнес-логика IDE.
//!
//! Не зависит от Tauri, тестируется через `cargo test`. Всё, что требует
//! системного окружения (webview, keychain, окна), лежит в `src-tauri`.

pub mod error;
pub mod fs;
pub mod git;
pub mod search;
pub mod settings;

pub use error::{CoreError, CoreResult};
