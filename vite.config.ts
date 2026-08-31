import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Tauri перечитывает при пересборке — Vite не должен спорить с ним за
      // блокировки на файлах src-tauri.
      ignored: ["**/src-tauri/**", "**/target/**"],
    },
  },
});
