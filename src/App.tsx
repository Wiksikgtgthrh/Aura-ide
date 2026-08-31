/**
 * Placeholder shell — Агент 2 заменит.
 *
 * Работает на моках, чтобы фронт можно было гонять до готовности бэкенда.
 * Реальный API появится в src/lib/tauriApi.ts после первого `pnpm tauri dev`
 * (tauri-specta сгенерирует файл в debug-сборке).
 */
export function App() {
  return (
    <div
      style={{
        height: "100vh",
        display: "grid",
        placeItems: "center",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        color: "#e5e7eb",
        background: "#0b0d10",
      }}
    >
      <div style={{ textAlign: "center", opacity: 0.8 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Aura IDE</h1>
        <p style={{ marginTop: 8, fontSize: 13 }}>
          Ожидание Агента 2 (UI-слой). Бэкенд поднят.
        </p>
      </div>
    </div>
  );
}
