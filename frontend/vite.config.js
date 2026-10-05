import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server on port 3000 — matches the CORS allow-list in backend/main.py
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: "127.0.0.1",
    strictPort: false,
  },
  preview: {
    port: 3000,
    host: "127.0.0.1",
  },
});
