import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Dev-time only: proxy API calls to the Express server (server.js) so
    // the React app can be developed with `npm run dev` without CORS setup.
    // In production, Express serves the built `dist/` directly — no proxy.
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
