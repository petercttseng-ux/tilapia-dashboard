import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sites } from "./build/sites-vite-plugin";

export default defineConfig({
  base: "./",
  plugins: [react(), sites()],
  server: {
    watch: { usePolling: process.env.CODEX_SANDBOX === "seatbelt" },
  },
});
