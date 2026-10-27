import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const webOrigin = loadEnv(mode, "../..", "WEB_ORIGIN").WEB_ORIGIN;
  const devPort = Number(new URL(webOrigin || "http://localhost:5173").port || 5173);
  return {
    plugins: [react()],
    // Workspace scripts run Vite from apps/web; load the shared root .env explicitly.
    envDir: "../..",
    cacheDir: ".vite-cache",
    build: {
      outDir: "../../dist/web",
      chunkSizeWarningLimit: 560,
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/mediasoup-client")) {
              return "vendor-mediasoup";
            }
            if (
              id.includes("node_modules/socket.io-client") ||
              id.includes("node_modules/engine.io-client")
            ) {
              return "vendor-socket";
            }
            if (id.includes("node_modules/motion") || id.includes("node_modules/framer-motion")) {
              return "vendor-motion";
            }
            if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
              return "vendor-react";
            }
          },
        },
      },
    },
    server: {
      port: devPort,
      // Follow WEB_ORIGIN and fail clearly instead of silently changing ports.
      strictPort: true,
      // Native file events can miss newly created modules on Windows volumes.
      watch: { usePolling: process.platform === "win32", interval: 300 },
      proxy: {
        "/health": "http://localhost:3001",
        "/auth": "http://localhost:3001",
        "/api": "http://localhost:3001",
        "/socket.io": {
          target: "http://localhost:3001",
          ws: true,
        },
      },
    },
  };
});
