//! Псевдо-терминалы через `portable-pty`.
//!
//! Одна PTY-сессия = { PtyPair, дочерний процесс шелла, writer, reader-тред }.
//! Reader-тред эмитит блоки байтов во фронт как `pty://out` с payload
//! `{ pty_id, data_b64 }`. Base64, потому что вывод шелла — байты, не строки.

use aura_core::error::{CoreError, CoreResult};
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use specta::Type;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::Emitter;

pub struct PtySession {
    pub id: String,
    pub master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    /// Живёт, пока сессия — держим тред-хэндл, чтобы не потерять reader.
    _reader: thread::JoinHandle<()>,
}

#[derive(Debug, Serialize, Clone, Type)]
pub struct PtyOutput {
    pub pty_id: String,
    /// Base64-энкоденный chunk stdout+stderr. Фронт декодирует и кормит xterm.
    pub data_b64: String,
}

#[derive(Debug, Serialize, Clone, Type)]
pub struct PtyExit {
    pub pty_id: String,
    pub exit_code: Option<i32>,
}

pub fn spawn(
    app: tauri::AppHandle,
    id: String,
    cwd: String,
    shell: Option<String>,
    cols: u16,
    rows: u16,
) -> CoreResult<PtySession> {
    let system = portable_pty::native_pty_system();
    let pair = system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| CoreError::Other(e.to_string()))?;

    let shell = shell.unwrap_or_else(default_shell);
    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(&cwd);
    // Наследуем env; ставим TERM=xterm-256color, чтобы приложения красились.
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| CoreError::Other(e.to_string()))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| CoreError::Other(e.to_string()))?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| CoreError::Other(e.to_string()))?;

    let app_for_reader = app.clone();
    let id_for_reader = id.clone();
    let reader_thread = thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let payload = PtyOutput {
                        pty_id: id_for_reader.clone(),
                        data_b64: b64_encode(&buf[..n]),
                    };
                    let _ = app_for_reader.emit("pty://out", payload);
                }
                Err(_) => break,
            }
        }
        let _ = app_for_reader.emit(
            "pty://exit",
            PtyExit {
                pty_id: id_for_reader.clone(),
                exit_code: None,
            },
        );
    });

    Ok(PtySession {
        id,
        master: Arc::new(Mutex::new(pair.master)),
        writer: Arc::new(Mutex::new(writer)),
        child: Arc::new(Mutex::new(child)),
        _reader: reader_thread,
    })
}

fn default_shell() -> String {
    if cfg!(target_os = "windows") {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
    }
}

/// Мини-base64 (URL-safe/standard) без внешней зависимости; для xterm alfабет
/// не важен, но следуем стандарту.
fn b64_encode(input: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(((input.len() + 2) / 3) * 4);
    let mut i = 0;
    while i + 3 <= input.len() {
        let n = ((input[i] as u32) << 16) | ((input[i + 1] as u32) << 8) | (input[i + 2] as u32);
        out.push(ALPHABET[((n >> 18) & 0x3F) as usize] as char);
        out.push(ALPHABET[((n >> 12) & 0x3F) as usize] as char);
        out.push(ALPHABET[((n >> 6) & 0x3F) as usize] as char);
        out.push(ALPHABET[(n & 0x3F) as usize] as char);
        i += 3;
    }
    match input.len() - i {
        1 => {
            let n = (input[i] as u32) << 16;
            out.push(ALPHABET[((n >> 18) & 0x3F) as usize] as char);
            out.push(ALPHABET[((n >> 12) & 0x3F) as usize] as char);
            out.push('=');
            out.push('=');
        }
        2 => {
            let n = ((input[i] as u32) << 16) | ((input[i + 1] as u32) << 8);
            out.push(ALPHABET[((n >> 18) & 0x3F) as usize] as char);
            out.push(ALPHABET[((n >> 12) & 0x3F) as usize] as char);
            out.push(ALPHABET[((n >> 6) & 0x3F) as usize] as char);
            out.push('=');
        }
        _ => {}
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn b64_matches_known_values() {
        assert_eq!(b64_encode(b""), "");
        assert_eq!(b64_encode(b"f"), "Zg==");
        assert_eq!(b64_encode(b"fo"), "Zm8=");
        assert_eq!(b64_encode(b"foo"), "Zm9v");
        assert_eq!(b64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(b64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(b64_encode(b"foobar"), "Zm9vYmFy");
    }
}
