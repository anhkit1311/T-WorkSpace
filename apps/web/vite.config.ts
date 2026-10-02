import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Workspace scripts run Vite from apps/web; load the shared root .env explicitly.
  envDir: "../..",
  cacheDir: ".vite-cache",
  build: {
    outDir: "../../dist/web",
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
    port: 5173,
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
});
