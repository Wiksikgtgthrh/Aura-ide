# Aura IDE

Настоящий десктоп IDE с AI-ассистентом на Tauri 2 + React 19.

## Стек

- **Backend**: Rust + Tauri 2, git2, portable-pty, ignore/grep (ripgrep as library)
- **Frontend**: React 19 + TypeScript + Vite, Monaco, xterm.js, Zustand
- **Contract**: `tauri-specta` — типизированные Rust ↔ TS команды через `src/lib/tauriApi.ts`

## Структура

```
aura-ide/
├── crates/
│   └── aura-core/          # Чистая бизнес-логика (fs / git / settings / search)
├── src-tauri/              # Тонкий Tauri-адаптер (команды + события)
├── src/                    # React-фронтенд (Агент 2)
├── package.json
└── vite.config.ts
```

## Разделение работы

- **Агент 1** (backend) — `crates/aura-core/` + `src-tauri/`.
- **Агент 2** (frontend) — `src/`, использует сгенерированные биндинги из `src/lib/tauriApi.ts`.

## Скрипты

```bash
pnpm install                 # деп фронта
pnpm tauri dev               # запуск в dev
pnpm tauri build             # релиз-сборка

# Только Rust
cargo check -p aura-core     # проверка чистой логики
cargo test -p aura-core      # тесты
```

## Требования системы

- Rust 1.80+ (stable)
- Node 20+, pnpm 9+
- Linux: `webkit2gtk-4.1`, `libsoup-3`, `gtk-3`
- macOS: Xcode CLT
- Windows: WebView2 (обычно уже стоит)
