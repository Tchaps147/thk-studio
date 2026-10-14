import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The assistant API (apps/api) runs beside the web app; see tools/dev.mjs.
const api = { "/api": `http://127.0.0.1:${process.env.THK_API_PORT ?? 5191}` };

export default defineConfig({
  plugins: [react()],
  server: { port: 5190, strictPort: true, proxy: api },
  preview: { port: 4190, strictPort: true, proxy: api },
});
