import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 3000,
    strictPort: true,
    // Windows locks Rust executables while Cargo links/runs them. Watching the
    // build output can raise EBUSY and terminate the whole Tauri dev session.
    watch: {
      ignored: [
        "**/src-tauri/target/**",
        "**/backend/.venv/**",
        "**/runtime/**",
        "**/deliverables/**",
        "**/__pycache__/**",
      ],
    },
    proxy: {
      "/ollama": {
        target: "http://127.0.0.1:11434",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ""),
      },
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
